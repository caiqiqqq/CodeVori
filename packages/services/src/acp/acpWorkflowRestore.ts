import { reduceWorkflowRunsState } from "@zcode/shared/zcode-protocol-v4";
import type { AcpSession } from "@zcode/shared";
import type { AcpWorkflowJournal } from "./acpWorkflowJournal.js";

export async function restoreAcpWorkflowProjection(
  session: AcpSession,
  journal: AcpWorkflowJournal,
  mutate: (session: AcpSession, change: () => void) => Promise<void>,
): Promise<void> {
  let projection: AcpSession["workflowRuns"];
  // 修复原因：journal 准入已落盘而会话进度快照尚未保存时崩溃，不能只遍历快照中的 run。
  for (const runId of journal.listRunIds()) {
    const row = journal.getRun(runId);
    if (!row || row.parentSessionId !== session.id) continue;
    if (row.status === "running") {
      // 修复原因：Host 重启后没有活的沙箱和 ACP actor，快照 running 不能伪装成可取消的任务。
      journal.updateRunStatus(row.runId, "stopped", { stopReason: "interrupted" });
      await journal.flush();
      journal.appendEvent(row.runId, {
        type: "run-settled",
        status: "stopped",
        stopReason: "interrupted",
      });
      await journal.flush();
    }
    for (const stored of journal.listEvents(row.runId)) {
      const { type, ...payload } = stored.event;
      projection =
        reduceWorkflowRunsState(projection, {
          runId: row.runId,
          ...(row.toolCallId ? { toolCallId: row.toolCallId } : {}),
          sequence: stored.sequence,
          eventType: type,
          payload: {
            ...payload,
            ...(type === "run-settled" && stored.event.status === "stopped"
              ? { resumable: true }
              : {}),
          },
        }) ?? projection;
    }
  }
  if (
    projection &&
    JSON.stringify(projection.runs) !== JSON.stringify(session.workflowRuns?.runs)
  ) {
    await mutate(session, () => {
      session.workflowRuns = projection;
    });
  }
}
