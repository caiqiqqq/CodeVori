import { appendFile, mkdir, open, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  InMemoryJournalStore,
  type ActorRecord,
  type Caps,
  type JournalStorePort,
  type NodeRecord,
  type RunEvent,
  type RunRecord,
  type RunSettlementRecord,
  type RunStatus,
} from "@zcode/dynamic-workflow";

type Change =
  | { action: "createRun"; record: RunRecord }
  | {
      action: "updateRunStatus";
      runId: string;
      status: RunStatus;
      settlement?: RunSettlementRecord;
    }
  | { action: "updateRunUsage"; runId: string; spentTokens: number }
  | { action: "updateRunCaps"; runId: string; caps: Caps }
  | { action: "putActor"; record: ActorRecord }
  | { action: "putNode"; record: NodeRecord }
  | { action: "appendEvent"; runId: string; event: RunEvent };

/** One append log per parent session: deterministic engine decisions have one durable source. */
export class AcpWorkflowJournal implements JournalStorePort {
  private readonly store = new InMemoryJournalStore();
  private readonly runIds: string[] = [];
  private tail: Promise<void> = Promise.resolve();
  private failed: unknown;
  private readonly path: string;

  private constructor(directory: string, parentId: string) {
    this.path = join(directory, "workflows", `${parentId}.jsonl`);
  }

  static async open(directory: string, parentId: string): Promise<AcpWorkflowJournal> {
    const journal = new AcpWorkflowJournal(directory, parentId);
    const contents = await readFile(journal.path, "utf8").catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return "";
      throw error;
    });
    // 修复原因：append 可能在崩溃时留下半行；只回放有换行封口的记录，不把未知结果当成完成。
    const completeBytes = Buffer.byteLength(contents.slice(0, contents.lastIndexOf("\n") + 1));
    if (completeBytes !== Buffer.byteLength(contents)) {
      const file = await open(journal.path, "r+");
      try {
        await file.truncate(completeBytes);
      } finally {
        await file.close();
      }
    }
    for (const line of contents.split("\n").slice(0, -1)) {
      if (line) journal.apply(JSON.parse(line) as Change);
    }
    return journal;
  }

  private apply(change: Change): void {
    switch (change.action) {
      case "createRun":
        this.store.createRun(change.record);
        this.runIds.push(change.record.runId);
        break;
      case "updateRunStatus":
        this.store.updateRunStatus(change.runId, change.status, change.settlement);
        break;
      case "updateRunUsage":
        this.store.updateRunUsage(change.runId, change.spentTokens);
        break;
      case "updateRunCaps":
        this.store.updateRunCaps(change.runId, change.caps);
        break;
      case "putActor":
        this.store.putActor(change.record);
        break;
      case "putNode":
        this.store.putNode(change.record);
        break;
      case "appendEvent":
        this.store.appendEvent(change.runId, change.event);
        break;
    }
  }

  private record(change: Change): void {
    if (this.failed) throw this.failed;
    this.apply(change);
    // 修复原因：引擎 journal 端口为同步决策接口；写盘仍排入同一异步队列。
    // driver 在一切外部副作用之前 flush；失败时不允许副作用继续执行。
    this.tail = this.tail
      .then(async () => {
        await mkdir(join(this.path, ".."), { recursive: true });
        await appendFile(this.path, `${JSON.stringify(change)}\n`, { mode: 0o600 });
      })
      .catch((error: unknown) => {
        this.failed = error;
        throw error;
      });
  }

  async flush(): Promise<void> {
    await this.tail;
  }
  listRunIds(): readonly string[] {
    return this.runIds;
  }
  createRun(record: RunRecord): void {
    this.record({ action: "createRun", record });
  }
  getRun(runId: string) {
    return this.store.getRun(runId);
  }
  updateRunStatus(runId: string, status: RunStatus, settlement?: RunSettlementRecord): void {
    this.record({
      action: "updateRunStatus",
      runId,
      status,
      ...(settlement ? { settlement } : {}),
    });
  }
  updateRunUsage(runId: string, spentTokens: number): void {
    this.record({ action: "updateRunUsage", runId, spentTokens });
  }
  updateRunCaps(runId: string, caps: Caps): void {
    this.record({ action: "updateRunCaps", runId, caps });
  }
  putActor(record: ActorRecord): void {
    this.record({ action: "putActor", record });
  }
  getActor(runId: string, siteId: string, ordinal: number) {
    return this.store.getActor(runId, siteId, ordinal);
  }
  listActors(runId: string) {
    return this.store.listActors(runId);
  }
  putNode(record: NodeRecord): void {
    this.record({ action: "putNode", record });
  }
  getNode(runId: string, siteId: string, ordinal: number) {
    return this.store.getNode(runId, siteId, ordinal);
  }
  listNodes(runId: string) {
    return this.store.listNodes(runId);
  }
  appendEvent(runId: string, event: RunEvent) {
    this.record({ action: "appendEvent", runId, event });
    return this.store.listEvents(runId).at(-1)!;
  }
  listEvents(runId: string, opts?: Parameters<JournalStorePort["listEvents"]>[1]) {
    return this.store.listEvents(runId, opts);
  }
}
