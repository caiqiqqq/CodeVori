import { useMemo, useState } from "react";
import type { AcpSession } from "@zcode/shared";
import { Button } from "@/components/ui/button.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.js";
import { Textarea } from "@/components/ui/textarea.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { ConversationQueuePanel } from "@/v4/ConversationQueuePanel.js";
import { projectAcpQueue } from "@/v4/acpQueueProjection.js";

interface Props {
  queue: AcpSession["queue"];
  actions: {
    deleteItem(id: string): Promise<void>;
    editItem(id: string, text: string): Promise<void>;
    moveItem(id: string, before: string | null): Promise<void>;
    sendNow(id: string): Promise<void>;
    resume(): Promise<void>;
  };
}

export function AcpConversationQueuePanel({ queue, actions }: Props) {
  const { intl } = useZCodeIntl();
  const projected = useMemo(() => projectAcpQueue(queue), [queue]);
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const item = queue.items.find((candidate) => candidate.commandId === editing?.id);
  // 操作错误由 hook 显示在当前会话；表单仍保留原文供用户重试。
  const handle = (task: Promise<void>) => {
    void task.catch(() => {});
  };
  const save = async () => {
    if (!editing || saving) return;
    setSaving(true);
    setError(null);
    try {
      await actions.editItem(editing.id, editing.text);
      setEditing(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };
  return (
    <>
      <ConversationQueuePanel
        queue={projected}
        onDeleteItem={(id) => handle(actions.deleteItem(id))}
        onEditItem={(id) => {
          const current = queue.items.find((candidate) => candidate.commandId === id);
          if (current) {
            setError(null);
            setEditing({ id, text: current.text });
          }
        }}
        onSendNow={(id) => handle(actions.sendNow(id))}
        onMoveItem={(id, before) => handle(actions.moveItem(id, before))}
        onResume={() => actions.resume().catch(() => {})}
      />
      <Dialog
        open={Boolean(editing)}
        onOpenChange={(open) => {
          if (!open && !saving) setEditing(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{intl.formatMessage({ id: "chat.queue.edit" })}</DialogTitle>
            <DialogDescription>
              {intl.formatMessage({ id: "acp.queue.editDescription" })}
            </DialogDescription>
          </DialogHeader>
          <Textarea
            data-testid="acp-queue-edit-text"
            aria-label={intl.formatMessage({ id: "chat.queue.edit" })}
            value={editing?.text ?? ""}
            disabled={saving || item?.state !== "queued"}
            className="min-h-28 text-ui-base"
            onChange={(event) =>
              setEditing((current) => (current ? { ...current, text: event.target.value } : null))
            }
          />
          {error ? (
            <p role="alert" className="text-ui-base text-destructive">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button variant="ghost" disabled={saving} onClick={() => setEditing(null)}>
              {intl.formatMessage({ id: "common.cancel" })}
            </Button>
            <Button
              data-testid="acp-queue-edit-save"
              disabled={
                saving ||
                item?.state !== "queued" ||
                (!editing?.text.trim() && !item.attachments.length && !item.workspaceFiles.length)
              }
              onClick={() => void save()}
            >
              {intl.formatMessage({ id: "common.save" })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
