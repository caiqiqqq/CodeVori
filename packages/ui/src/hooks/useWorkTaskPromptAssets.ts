import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  workTaskCreateSchema,
  resolveWorkspaceKey,
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
import { WorkTaskAttachmentResources } from "./workTaskAttachmentResources.js";

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
export function useWorkTaskAttachmentPreview(
  scope: WorkTaskScope,
  attachments: readonly ChatComposerAttachment[],
) {
  const resolution = useTaskServices(scope);
  const files =
    resolution && !resolution.isRemoteWorkspace ? resolution.services.fileService : null;
  const owner = JSON.stringify([
    resolveWorkspaceKey(scope),
    scope.workspacePath,
    scope.remoteSessionId,
  ]);
  const resources = useMemo(() => new WorkTaskAttachmentResources(files), [files, owner]);
  useSyncExternalStore(resources.subscribe, resources.getSnapshot, resources.getSnapshot);
  const [opened, setOpened] = useState<{
    owner: WorkTaskAttachmentResources;
    attachment: ChatComposerAttachment;
  } | null>(null);
  useEffect(() => () => resources.clear(), [resources]);
  useEffect(() => resources.sync(attachments), [resources, attachments]);
  const attachment =
    opened?.owner === resources
      ? attachments.find((item) => item.id === opened.attachment.id)
      : undefined;
  return {
    preview: attachment ? { attachment, ...resources.get(attachment) } : null,
    get: (item: ChatComposerAttachment) => resources.get(item),
    open: (item: ChatComposerAttachment) => {
      setOpened({ owner: resources, attachment: item });
      void resources.load(item, true);
    },
    close: () => setOpened(null),
  };
}
