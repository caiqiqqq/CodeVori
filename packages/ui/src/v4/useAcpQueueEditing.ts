import { useCallback, useRef, useState } from "react";
import type { IAcpService } from "@zcode/services";
import {
  acpSessionSchema,
  type AcpQueueItem,
  type AcpSession,
  type AcpWorkspace,
} from "@zcode/shared";
import { createAcpAttachmentReader } from "@/hooks/useAcpAttachmentReader.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { toast } from "@/components/ui/toast.js";
import type { ComposerRestoreRequest } from "@/v4/ConversationComposer.js";
import { acpQueuedEditorState } from "@/v4/composer/acpPromptDraft.js";

/** 撤回只拥有本 pane 的临时操作；accepted queue 仍完全由 Host 管理。 */
export function useAcpQueueEditing({
  service,
  workspace,
  session,
  scopeId,
  draftState,
  restore,
  withdraw,
}: {
  service: IAcpService;
  workspace: AcpWorkspace;
  session: AcpSession | null;
  scopeId: string | undefined;
  draftState: { current: { hasContent: boolean; busy: boolean } };
  restore: (request: ComposerRestoreRequest) => void;
  withdraw: (item: AcpQueueItem) => Promise<AcpSession | undefined>;
}) {
  const { intl } = useZCodeIntl();
  const key = JSON.stringify([
    workspace.workspaceIdentity?.trim() || workspace.workspacePath,
    workspace.workspacePath,
    workspace.remoteSessionId,
    session?.agent,
    session?.id,
  ]);
  const operation = useRef<{ key: string; id: string; requestId?: number } | null>(null);
  const binding = useRef({ key, service });
  // 切走再切回也必须作废旧等待，不能仅用最终相同的 session key 认领迟到 ACK。
  if (binding.current.key !== key || binding.current.service !== service) operation.current = null;
  binding.current = { key, service };
  const [pending, setPending] = useState<typeof operation.current>(null);
  const nextRequest = useRef(0);
  const edit = useCallback(
    async (id: string) => {
      if (!session || !scopeId || operation.current?.key === key) return;
      if (draftState.current.hasContent || draftState.current.busy) {
        toast(intl.formatMessage({ id: "chat.queue.editDraftConflict" }));
        return;
      }
      const item = session.queue.items.find((item) => item.commandId === id);
      if (!item || item.state !== "queued") return;
      const expectedItem = structuredClone(item);
      const token = { key, id };
      operation.current = token;
      setPending(token);
      const current = () =>
        binding.current.key === key &&
        binding.current.service === service &&
        operation.current === token;
      try {
        // 修复原因：删除会清理 Host 副本，必须在删除前读完附件，失败时保留原项。
        const reader = createAcpAttachmentReader(service, workspace, session.id);
        const files = await Promise.all(
          expectedItem.attachments.map(async (attachment) => {
            const result = await reader.readAttachment({
              sessionId: session.id,
              ref: attachment.ref,
            });
            if (result.bytes.length !== attachment.bytes || result.mediaType !== attachment.mime)
              throw new Error("ACP queue attachment changed");
            return new File([result.bytes as Uint8Array<ArrayBuffer>], attachment.fileName, {
              type: attachment.mime,
            });
          }),
        );
        if (!current()) return;
        const result = await withdraw(expectedItem);
        if (!current()) return;
        const snapshot = acpSessionSchema.parse(result);
        if (
          snapshot.id !== session.id ||
          snapshot.workspacePath !== workspace.workspacePath ||
          (snapshot.workspaceIdentity?.trim() || snapshot.workspacePath) !==
            (workspace.workspaceIdentity?.trim() || workspace.workspacePath) ||
          snapshot.remoteSessionId !== workspace.remoteSessionId ||
          !snapshot.queue.discardedCommandIds?.includes(id) ||
          snapshot.queue.items.some((item) => item.commandId === id)
        )
          throw new Error("ACP queue withdrawal was not confirmed");
        // 修复依据：迟到 ACK 可以确认旧 Host 的删除，但绝不能写入新 Agent/workspace/session 草稿。
        if (!current() || draftState.current.hasContent || draftState.current.busy) return;
        const requestId = --nextRequest.current;
        operation.current!.requestId = requestId;
        restore({
          requestId,
          sessionId: session.id,
          scopeId,
          workspaceKey: workspace.workspaceIdentity?.trim() || workspace.workspacePath,
          inputKind: "sendText",
          text: expectedItem.text,
          attachments: [],
          files,
          editorStateJson: acpQueuedEditorState(expectedItem.text, expectedItem.workspaceFiles),
        });
      } catch {
        if (current())
          toast(intl.formatMessage({ id: "chat.queue.editRestoreFailed" }), { variant: "warning" });
      } finally {
        if (operation.current === token && operation.current.requestId === undefined) {
          operation.current = null;
          setPending(null);
        }
      }
    },
    [draftState, intl, key, restore, scopeId, service, session, workspace, withdraw],
  );
  const applied = useCallback((requestId: number) => {
    if (operation.current?.requestId !== requestId) return;
    operation.current = null;
    setPending(null);
  }, []);
  return {
    edit,
    pendingId: pending?.key === key && pending === operation.current ? pending.id : null,
    applied,
  };
}
