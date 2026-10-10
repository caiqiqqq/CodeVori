import type { MutableRefObject, ReactNode } from "react";
import type { WorkTask, WorkTaskScope } from "@zcode/shared";
import type { LexicalChatInputHandle } from "@/LexicalChatInput.js";
import type { useWorkTaskPromptAssets } from "@/hooks/useWorkTaskPromptAssets.js";
import { ServiceProvider } from "@/hooks/useServices.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { ChatPromptEditor } from "@/prompt-editor/ChatPromptEditor.js";
import { WorkTaskError, useWorkTaskMessages } from "./WorkTaskParts.js";
import { WorkTaskAttachments } from "./WorkTaskAttachments.js";

export function WorkTaskPromptField({
  scope,
  task,
  initialPrompt,
  busy,
  assets,
  inputApiRef,
  leadingActions,
  trailingActions,
  onChange,
}: {
  scope: WorkTaskScope;
  task: WorkTask | null;
  initialPrompt?: string;
  busy: boolean;
  assets: ReturnType<typeof useWorkTaskPromptAssets>;
  inputApiRef: MutableRefObject<LexicalChatInputHandle | null>;
  leadingActions?: ReactNode;
  trailingActions?: ReactNode;
  onChange(value: string): void;
}) {
  const t = useWorkTaskMessages();
  const { intl } = useZCodeIntl();
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span className="text-ui-sm text-foreground-subtle">{t("prompt")}</span>
      {assets.services ? (
        <ServiceProvider services={assets.services}>
          <ChatPromptEditor
            embedded
            workspacePath={scope.workspacePath}
            workspaceIdentity={scope.workspaceIdentity}
            taskId={null}
            initialValue={task?.prompt ?? initialPrompt ?? ""}
            initialEditorStateJson={task?.promptEditorState}
            inputApiRef={inputApiRef}
            inputTestId="work-task-prompt"
            shellClassName="[&_[contenteditable]]:min-h-16 [&_[contenteditable]]:max-h-64"
            placeholder={t("prompt")}
            disabled={busy}
            submitDisabled
            submitLabel={t("save")}
            submitControl={<span />}
            leadingActions={leadingActions}
            trailingActions={trailingActions}
            toolbarLayout={leadingActions ? "wrap" : "compact"}
            enterSubmits={false}
            filesOnlyMentions
            enableSlashCommands={false}
            enableWorkspaceFileDrop={!busy}
            enableExternalFileDrop={!busy}
            isDraggingOver={assets.isDraggingOverComposer}
            dragAttachmentHint={intl.formatMessage({ id: "chat.attachments.dragHint" })}
            attachmentAction={{
              label: intl.formatMessage({ id: "chat.attachments.add" }),
              onSelect: assets.openAttachmentPicker,
              testId: "work-task-add-menu",
              menuItemTestId: "work-task-add-attachment",
            }}
            topContent={
              <WorkTaskAttachments
                scope={scope}
                items={assets.attachments}
                onRemove={assets.removeAttachment}
                disabled={busy}
              />
            }
            onChange={onChange}
            onSubmit={() => false}
            onPaste={assets.handlePaste}
            onDragOver={assets.handleDragOverComposer}
            onDragLeave={assets.handleDragLeaveComposer}
            onDrop={assets.handleDropComposer}
          />
        </ServiceProvider>
      ) : (
        <WorkTaskError error="work-task.disconnected" />
      )}
      <input
        type="file"
        multiple
        hidden
        ref={assets.attachmentInputRef}
        onChange={assets.handleAttachmentInputChange}
        data-testid="work-task-file-input"
        disabled={busy}
      />
    </div>
  );
}
