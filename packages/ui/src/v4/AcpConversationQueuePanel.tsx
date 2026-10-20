import { useMemo } from "react";
import type { AcpSession } from "@zcode/shared";
import { ConversationQueuePanel } from "@/v4/ConversationQueuePanel.js";
import { projectAcpQueue, type AcpQueueSubmission } from "@/v4/acpQueueProjection.js";

interface Props {
  queue: AcpSession["queue"];
  pendingSubmission?: AcpQueueSubmission | null;
  onEditItem: (id: string) => Promise<void>;
  pendingEditQueueItemId: string | null;
  actions: {
    deleteItem(id: string): Promise<void>;
    moveItem(id: string, before: string | null): Promise<void>;
    sendNow(id: string): Promise<void>;
    resume(): Promise<void>;
  };
}

export function AcpConversationQueuePanel({
  queue,
  pendingSubmission,
  onEditItem,
  pendingEditQueueItemId,
  actions,
}: Props) {
  const projected = useMemo(() => projectAcpQueue(queue), [queue]);
  // 操作错误由所属 hook 呈现；撤回编辑与 API 共用 composer 和行级等待反馈。
  const handle = (task: Promise<void>) => {
    void task.catch(() => {});
  };
  return (
    <ConversationQueuePanel
      queue={projected}
      pendingSubmission={pendingSubmission}
      onDeleteItem={(id) => handle(actions.deleteItem(id))}
      onEditItem={onEditItem}
      pendingEditQueueItemId={pendingEditQueueItemId}
      onSendNow={(id) => handle(actions.sendNow(id))}
      onMoveItem={(id, before) => handle(actions.moveItem(id, before))}
      onResume={() => actions.resume().catch(() => {})}
    />
  );
}
