import {
  workTaskChangeRecordSchema,
  type WorkTask,
  type WorkTaskForgeWriteback,
  type WorkTaskChangeRecord,
} from "@zcode/shared";
import type { WorkTaskRepo } from "./workTaskRepo.js";
import type { WorkTaskForgePort } from "./workTask.js";
import { workTaskForgeComment, workTaskForgeMarker } from "./workTaskForgeState.js";

/** Host owns durable intent/receipts. Remote calls reuse the existing validated Forge port. */
export async function writebackWorkTaskForge(input: {
  task: WorkTask;
  repo: WorkTaskRepo;
  forge: WorkTaskForgePort;
  owner: string;
  publish(): void;
  closed(): boolean;
  resendComment?: boolean;
  readRecords?(task: WorkTask): Promise<WorkTaskChangeRecord>;
}): Promise<WorkTask> {
  let task = input.repo.claimForgeWriteback(input.task, input.owner);
  const id = task.forgeWriteback!.id;
  const save = (patch: Partial<WorkTaskForgeWriteback>, event = "forge-writeback") => {
    task = input.repo.writeForgeState(
      task,
      id,
      { ...task.forgeWriteback!, leaseUntil: Date.now() + 30_000, ...patch },
      input.owner,
      event,
    );
    input.publish();
  };
  const assertOwner = () => {
    if (input.closed()) throw new Error("work-task.host-closed");
    save({});
  };
  const timer = setInterval(() => {
    try {
      save({}, "forge-writeback-lease");
    } catch {
      clearInterval(timer);
    }
  }, 10_000);
  timer.unref();
  const source = task.source!;
  const target = {
    workspacePath: task.workspacePath,
    workspaceIdentity: task.workspaceIdentity,
    repositoryKey: source.repositoryKey,
    remoteName: source.remoteName,
    accountId: source.accountId,
    kind: source.kind,
    number: source.number,
  };
  let step: "commentState" | "closeState" = "commentState";
  try {
    input.publish();
    // 第一次发送前冻结真实合并结果；评论 ACK 丢失后重试必须使用同一份内容。
    if (task.forgeWriteback!.commentState === "pending" && !task.forgeWriteback!.recordsFinalized) {
      let records = task.forgeWriteback!.records;
      try {
        if (input.readRecords)
          records = workTaskChangeRecordSchema.parse(await input.readRecords(task));
      } catch {
        records = { state: "unknown", commits: [], files: [], uncommitted: [], truncated: false };
      }
      assertOwner();
      save({ records, recordsFinalized: true });
    }
    if (!["done", "skipped"].includes(task.forgeWriteback!.commentState)) {
      const previous = task.forgeWriteback!.commentState;
      let found = false;
      // 修复依据：POST 成功但 ACK/进程丢失时，持久化标记能恢复收据，不能直接重复发送。
      for (let page = 1; ; page++) {
        assertOwner();
        const comments = await input.forge.listForgeComments({ ...target, page, pageSize: 100 });
        if (comments.items.some((comment) => comment.body.includes(workTaskForgeMarker(task)))) {
          found = true;
          break;
        }
        if (!comments.hasMore) break;
        if (page === 1000) throw new Error("work-task.forge-reconcile-limit");
      }
      assertOwner();
      if (!found) {
        if (["sending", "uncertain"].includes(previous) && !input.resendComment)
          throw new Error("work-task.forge-comment-uncertain");
        save({ commentState: "sending", error: undefined });
        await input.forge.createForgeComment({ ...target, body: workTaskForgeComment(task) });
      }
      save({ commentState: "done", error: undefined });
    }
    step = "closeState";
    if (!["done", "skipped"].includes(task.forgeWriteback!.closeState)) {
      assertOwner();
      const item = await input.forge.getForgeItem(target);
      if (item.state !== "closed") {
        assertOwner();
        save({ closeState: "sending", error: undefined });
        await input.forge.setForgeItemState({ ...target, state: "closed" });
        const latest = await input.forge.getForgeItem(target);
        if (latest.state !== "closed") throw new Error("work-task.forge-not-closed");
      }
      save({ closeState: "done", error: undefined });
    }
    save({ owner: undefined, leaseUntil: undefined, error: undefined });
    return task;
  } catch (error) {
    const message = error instanceof Error ? error.message : "work-task.forge-writeback-failed";
    // 任务已完成，远端失败只改变回写收据；评论发送中的异常保持不确定，须先核对标记。
    const uncertain =
      step === "commentState" &&
      ["sending", "uncertain"].includes(task.forgeWriteback!.commentState);
    try {
      save(
        {
          [step]: uncertain ? "uncertain" : "failed",
          owner: undefined,
          leaseUntil: undefined,
          error: /^(?:FORGE_[A-Z_]+|work-task\.[a-z-]+)$/.test(message)
            ? message
            : "work-task.forge-writeback-failed",
        },
        "forge-writeback-failed",
      );
    } catch {
      /* 旧 owner/run 已失效，不能覆盖新事实。 */
    }
    throw error;
  } finally {
    clearInterval(timer);
  }
}
