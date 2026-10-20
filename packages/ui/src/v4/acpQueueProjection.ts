import type { AcpSession } from "@zcode/shared";
import type { QueueState } from "@zcode/shared/zcode-protocol-v4";

/** Local in-flight feedback, never an accepted queue item. */
export interface AcpQueueSubmission {
  commandId: string;
  text: string;
}

export function visibleAcpQueueSubmission(
  session: {
    entries: readonly { id: string }[];
    queue: {
      items: readonly { commandId: string }[];
      discardedCommandIds?: readonly string[];
    };
  },
  submission: AcpQueueSubmission | null,
): AcpQueueSubmission | null {
  // 修复依据：live 接受通知可能早于 RPC ACK，也可能已直接执行或删除；按同一 command 去重。
  if (
    !submission ||
    session.queue.items.some((item) => item.commandId === submission.commandId) ||
    session.entries.some((entry) => entry.id === `user:${submission.commandId}`) ||
    session.queue.discardedCommandIds?.includes(submission.commandId)
  )
    return null;
  return submission;
}

/** Presentation only: ACP Host facts adapt to the existing shared queue surface. */
export function projectAcpQueue(queue: AcpSession["queue"]): QueueState {
  return {
    autoDrain: queue.autoDrain,
    pauseReason: queue.pauseReason,
    items: queue.items.map((item, index) => ({
      sourceCommandId: item.commandId,
      queueItemId: item.commandId,
      clientId: "acp-host",
      kind: "sendText",
      text: item.text.trim()
        ? item.text
        : [
            ...item.attachments.map((attachment) => attachment.fileName),
            ...item.workspaceFiles,
          ].join(", "),
      attachments: item.attachments,
      delivery: { requested: "queue", admitted: "queue" },
      order: { admissionSeq: index, queuePosition: index },
      steer: { state: "notRequested" },
      dispatch: { state: item.state },
      admittedAt: item.createdAt,
    })),
  };
}
