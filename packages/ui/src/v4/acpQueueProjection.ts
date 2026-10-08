import type { AcpSession } from "@zcode/shared";
import type { QueueState } from "@zcode/shared/zcode-protocol-v4";

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
