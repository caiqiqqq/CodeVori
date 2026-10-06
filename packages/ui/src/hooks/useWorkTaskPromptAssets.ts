import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  workTaskCreateSchema,
  type WorkTask,
  type WorkTaskAttachment,
  type WorkTaskExecution,
  type WorkTaskScope,
} from "@zcode/shared";
import { PROTOCOL_V4_LIMITS } from "@zcode/shared/zcode-protocol-v4";
import { useBaseWorkspaceServices } from "./useWorkspaceServices.js";
import { useRemoteWorkspaceSessionStore } from "@/store/remoteWorkspaceSessionStore.js";
import { resolveWorkspaceServices } from "@/lib/workspaceServiceResolver.js";
import { useComposerAttachments } from "@/v4/composer/useComposerAttachments.js";
import { uploadAttachmentBytes } from "@/v4/attachmentUploadTransaction.js";
import type { ChatComposerAttachment } from "@/lib/chatAttachments.js";
import { acpWorkspaceFilesFromEditor } from "@/v4/composer/acpPromptDraft.js";
import type { LexicalChatInputHandle } from "@/LexicalChatInput.js";

function useTaskServices(scope: WorkTaskScope) {
  const base = useBaseWorkspaceServices();
  const remote = useRemoteWorkspaceSessionStore((state) => state);
  return useMemo(() => resolveWorkspaceServices(scope, base, remote), [scope, base, remote]);
}

export function useWorkTaskPromptAssets(
  scope: WorkTaskScope,
  task: WorkTask | null,
  disabled: boolean,
) {
  const resolution = useTaskServices(scope);
  const [scopeId] = useState(() => `work-task-editor:${crypto.randomUUID()}`);
  const composer = useComposerAttachments({
    ...scope,
    scopeId,
    collectionOnly: true,
    disabled,
    listenAddToChatEvents: false,
  });
  const saved = useRef(new Map<string, WorkTaskAttachment>());
  const [initialAttachments] = useState(() => task?.attachments);
  useEffect(() => {
    if (initialAttachments?.length) composer.restoreSessionOwnedAttachments(initialAttachments);
  }, [initialAttachments, composer.restoreSessionOwnedAttachments]);
  const prepare = useCallback(
    async (kind: "api" | "acp", signal: AbortSignal) => {
      if (!composer.attachments.length) return [];
      if (!resolution) throw new Error("work-task.disconnected");
      if (resolution.isRemoteWorkspace || scope.workspaceIdentity || scope.remoteSessionId)
        throw new Error("work-task.remote-unsupported");
      const service = resolution.services.workTaskService;
      if (!service) throw new Error("work-task.attachments-unsupported");
      const attachments: WorkTaskAttachment[] = [];
      for (const item of composer.attachments) {
        signal.throwIfAborted();
        if (kind === "acp" && /^(audio|video)\//.test(item.mimeType))
          throw new Error("work-task.attachment-unsupported-media");
        const cached = saved.current.get(item.id);
        if (cached) {
          attachments.push(cached);
          continue;
        }
        if (item.referenceOwnership === "session" && item.attachmentRef) {
          attachments.push(item.attachmentRef);
          continue;
        }
        const common = { fileName: item.filename, mime: item.mimeType };
        let attachment: WorkTaskAttachment;
        if (item.localPath) {
          attachment = await service.attachmentImport({
            ...scope,
            ...common,
            localPath: item.localPath,
          });
        } else {
          if (!item.file) throw new Error("work-task.attachment-content-missing");
          if (item.file.size > PROTOCOL_V4_LIMITS.attachmentMaxBytes)
            throw new Error("work-task.attachment-too-large");
          const bytes = new Uint8Array(await item.file.arrayBuffer());
          const result = await uploadAttachmentBytes(
            {
              begin: (data) => service.attachmentBegin({ ...scope, ...data }),
              chunk: (data) => service.attachmentChunk({ ...scope, ...data }),
              commit: (data) => service.attachmentCommit({ ...scope, ...data }),
              abort: (data) => service.attachmentAbort({ ...scope, ...data }),
            },
            { ...common, bytes },
            { signal },
          );
          attachment = { ...common, ref: result.ref, bytes: bytes.length };
        }
        saved.current.set(item.id, attachment);
        attachments.push(attachment);
      }
      signal.throwIfAborted();
      return attachments;
    },
    [composer.attachments, resolution, scope],
  );
  const prepareDraft = async (
    title: string,
    execution: WorkTaskExecution,
    input: LexicalChatInputHandle,
    signal: AbortSignal,
  ) => {
    const promptEditorState = JSON.stringify(input.getEditorState().toJSON());
    const parsed = workTaskCreateSchema.parse({
      ...scope,
      title: title.trim(),
      prompt: input.getMarkdown().trim(),
      execution,
      promptEditorState,
      workspaceFiles: acpWorkspaceFilesFromEditor(promptEditorState),
    });
    const attachments = await prepare(execution.kind, signal);
    return {
      title: parsed.title,
      prompt: parsed.prompt,
      execution,
      promptEditorState,
      workspaceFiles: parsed.workspaceFiles,
      attachments,
    };
  };
  return { ...composer, prepareDraft, services: resolution?.services, rpcReady: !!resolution };
}

/** Preview uses file IO on the selected Host, never a conversation/Agent attachment. */
export function useWorkTaskAttachmentPreview(scope: WorkTaskScope) {
  const resolution = useTaskServices(scope);
  const [preview, setPreview] = useState<{
    attachment: ChatComposerAttachment;
    url?: string;
    loading?: boolean;
    error?: boolean;
  } | null>(null);
  const sequence = useRef(0);
  const ownedUrl = useRef<string | null>(null);
  const clear = useCallback(() => {
    sequence.current++;
    if (ownedUrl.current) URL.revokeObjectURL(ownedUrl.current);
    ownedUrl.current = null;
  }, []);
  useEffect(() => () => clear(), [clear, resolution]);
  const open = useCallback(
    async (attachment: ChatComposerAttachment) => {
      clear();
      const request = sequence.current;
      setPreview({ attachment, url: attachment.objectUrl, loading: !attachment.objectUrl });
      if (attachment.objectUrl) return;
      try {
        if (!resolution || resolution.isRemoteWorkspace || !attachment.localPath)
          throw new Error("work-task.disconnected");
        const files = resolution.services.fileService;
        const stat = await files.stat({ path: attachment.localPath });
        if (
          stat.type !== "file" ||
          typeof stat.size !== "number" ||
          stat.size > PROTOCOL_V4_LIMITS.attachmentMaxBytes
        )
          throw new Error("work-task.attachment-too-large");
        const bytes = new Uint8Array(stat.size);
        for (let offset = 0; offset < bytes.length; ) {
          if (request !== sequence.current) return;
          const chunk = await files.readFileRange({
            path: attachment.localPath,
            offset,
            length: Math.min(384 * 1024, bytes.length - offset),
          });
          if (!chunk.length || offset + chunk.length > bytes.length)
            throw new Error("work-task.attachment-size-mismatch");
          bytes.set(chunk, offset);
          offset += chunk.length;
        }
        if (request !== sequence.current) return;
        const url = URL.createObjectURL(new Blob([bytes], { type: attachment.mimeType }));
        ownedUrl.current = url;
        setPreview({ attachment, url });
      } catch {
        if (request === sequence.current) setPreview({ attachment, error: true });
      }
    },
    [clear, resolution],
  );
  return {
    preview,
    open,
    close: () => {
      clear();
      setPreview(null);
    },
  };
}
