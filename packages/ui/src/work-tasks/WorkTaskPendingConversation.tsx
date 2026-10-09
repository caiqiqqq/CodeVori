import { useMemo, useRef } from "react";
import { LoaderCircle, Plus } from "lucide-react";
import { acpAgentDefinition, type AcpConfigOption, type WorkTask } from "@zcode/shared";
import type { UserInputRow } from "@zcode/shared/zcode-protocol-v4";
import { ModelConfigSelect, type ModelSelectGroup } from "@/ModelConfigSelect.js";
import { ControlHintTooltip } from "@/ControlHintTooltip.js";
import { Button } from "@/components/ui/button.js";
import { ThoughtLevelCycleControl } from "@/chat-input-toolbar/ThoughtLevelCycleControl.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { encodeCustomModelValue } from "@/lib/zcodeCustomModelValue.js";
import { DEFAULT_CODE_PREVIEW_SETTINGS } from "@/lib/codePreviewSettings.js";
import { ChatPromptEditor } from "@/prompt-editor/ChatPromptEditor.js";
import { useZCodeStoreWithDefault } from "@/store/StoreProvider.js";
import { ConversationTimeline } from "@/v4/ConversationTimeline.js";
import { AcpComposerConfigControls } from "@/v4/composer/AcpComposerConfigControls.js";
import { V4ComposerModeSwitch } from "@/v4/composer/V4ComposerModeControls.js";
import { acpModelValue } from "@/v4/composer/acpModelSelection.js";
import { WorkTaskError, useWorkTaskMessages } from "./WorkTaskParts.js";
import { WorkTaskAttachments } from "./WorkTaskAttachments.js";
import type { ConversationRowRenderContext } from "@/v4/conversationRowContext.js";

const EMPTY_MODEL_GROUPS: readonly ModelSelectGroup[] = [];
function ignoreChange() {}
function rejectSubmission() {
  return false;
}

function PendingTaskControls({ task }: { task: WorkTask }) {
  const { intl } = useZCodeIntl();
  const t = useWorkTaskMessages();
  const thoughtRef = useRef<HTMLSpanElement>(null);
  const execution = task.execution;
  const reason = t("noConversation");
  const reasoning =
    execution.kind === "api" ? execution.modelSelection.options?.reasoningLevel : undefined;
  // 这里只展示保存值，不把其他历史会话的默认值或能力列表当成当前任务配置。
  const savedAcpOptions: AcpConfigOption[] =
    execution.kind === "acp"
      ? execution.config.map(({ configId, value }) =>
          typeof value === "boolean"
            ? { id: configId, name: configId, type: "boolean", currentValue: value }
            : {
                id: configId,
                name: configId,
                type: "select",
                currentValue: value,
                options: [{ value, name: value }],
              },
        )
      : [];
  return (
    <>
      <ControlHintTooltip title={intl.formatMessage({ id: "chat.composer.actionMenu" })}>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          disabled
          aria-label={intl.formatMessage({ id: "chat.composer.actionMenu" })}
        >
          <Plus className="size-4" />
        </Button>
      </ControlHintTooltip>
      {execution.kind === "api" ? (
        <V4ComposerModeSwitch
          workspacePath={task.workspacePath}
          draftConfig={{
            mode: execution.mode === "plan" ? "build" : execution.mode,
            planEnabled: execution.mode === "plan",
          }}
          disabled
          activeConfigPicker={null}
          onConfigPickerOpenChange={ignoreChange}
          onSwitchMode={ignoreChange}
        />
      ) : (
        <AcpComposerConfigControls
          agent={execution.agent}
          options={savedAcpOptions}
          modes={null}
          disabled
          focusSelectorOnClose={null}
        />
      )}
      <ModelConfigSelect
        modelGroups={EMPTY_MODEL_GROUPS}
        normalizedValue={
          execution.kind === "acp"
            ? acpModelValue(execution.agent)
            : encodeCustomModelValue(
                execution.modelSelection.providerId,
                execution.modelSelection.modelId,
              )
        }
        triggerLabel={
          execution.kind === "acp"
            ? acpAgentDefinition(execution.agent).name
            : execution.modelSelection.modelId
        }
        disabled
        showManageModelsAction={false}
        lockReasonMessage={reason}
        isItemLocked={() => true}
        onValueChange={ignoreChange}
        labelVisibilityClassName="inline-flex min-w-0 truncate"
        indicatorClassName="block group-data-[composer-model-icon=true]/toolbar:hidden"
        triggerLabelClassName="block min-w-0 text-left group-data-[composer-model-icon=true]/toolbar:hidden [&>span]:max-w-full [&>span>span]:block [&>span>span]:truncate"
        triggerClassName="h-7 max-w-44 group-data-[composer-model-icon=true]/toolbar:size-7 group-data-[composer-model-icon=true]/toolbar:p-0 group-data-[composer-model-icon=true]/toolbar:gap-0 group-data-[composer-model-icon=true]/toolbar:justify-center"
        triggerIconClassName="hidden group-data-[composer-model-icon=true]/toolbar:inline-flex"
        triggerTestId="work-task-pending-model"
        focusSelectorOnClose={null}
      />
      {reasoning ? (
        <ThoughtLevelCycleControl
          intl={intl}
          triggerRef={thoughtRef}
          option={{
            id: "reasoningLevel",
            name: intl.formatMessage({ id: "chat.toolbar.thoughtLevel.label" }),
            type: "select",
            currentValue: reasoning,
            options: [{ value: reasoning, name: reasoning }],
          }}
          disabled
          disabledReason={reason}
          composerCollapsePriority={3}
          labelVisibilityClassName="inline-flex"
          restoreFocusSelector={null}
          onValueChange={ignoreChange}
        />
      ) : null}
    </>
  );
}

/** 未绑定时仅投影任务记录；真实会话和草稿仍由绑定后的 SessionPane 持有。 */
export function WorkTaskPendingConversation({ task }: { task: WorkTask }) {
  const { intl } = useZCodeIntl();
  const t = useWorkTaskMessages();
  const theme = useZCodeStoreWithDefault((state) => state.theme, "system");
  const codePreviewSettings = useZCodeStoreWithDefault(
    (state) => state.codePreviewSettings,
    DEFAULT_CODE_PREVIEW_SETTINGS,
  );
  const rows = useMemo<UserInputRow[]>(
    () => [
      {
        kind: "userInput",
        origin: "synthetic",
        rowId: 1,
        turnId: "work-task-preview",
        createdAt: task.createdAt,
        createdAtSeq: 0,
        text: task.runSeq > 0 ? task.runText : task.prompt,
        attachments: task.runSeq > 0 && task.runUsesPromptAssets === false ? [] : task.attachments,
      },
    ],
    [
      task.createdAt,
      task.prompt,
      task.runSeq,
      task.runText,
      task.runUsesPromptAssets,
      task.attachments,
    ],
  );
  const rowContext = useMemo<ConversationRowRenderContext>(
    () => ({
      workspacePath: task.workspacePath,
      workspaceIdentity: task.workspaceIdentity,
      workspaceRemoteSessionId: task.remoteSessionId,
      theme,
      codePreviewSettings,
      // 待办附件是 Host 保存的文件，不属于会话；原读取器要求 sessionId，因而只显示占位图。
      // 复用任务预览的文件 IO 和资源生命周期，不为显示图片创建或伪造会话。
      renderUserInputAttachments: (attachments, kind) => (
        <WorkTaskAttachments
          scope={task}
          saved={attachments}
          attachmentKind={kind}
          presentation="conversation"
        />
      ),
    }),
    [task, theme, codePreviewSettings],
  );
  const preparing = task.status === "preparing";
  const status = t(preparing ? "preparingConversation" : "noConversation");
  return (
    <div
      className="@container/conversation relative flex h-full min-h-0 min-w-0 flex-col"
      data-testid="work-task-unstarted"
    >
      <ConversationTimeline
        rows={rows}
        totalCount={rows.length}
        sessionKey={`work-task-preview:${task.id}`}
        rowContext={rowContext}
        workDurationAvailable={false}
        hideTurnNavigator
        footerSlot={
          <div className="space-y-3 px-4 pb-4">
            <WorkTaskError error={task.failureReason ?? null} />
            {task.workspaceIdentity || task.remoteSessionId ? (
              <WorkTaskError error="work-task.remote-unsupported" />
            ) : (
              <p
                role="status"
                data-testid={preparing ? "work-task-preparing" : undefined}
                className="flex items-center gap-2 text-ui-sm text-foreground-subtle"
              >
                {preparing ? <LoaderCircle className="size-4 shrink-0 animate-spin" /> : null}
                {status}
              </p>
            )}
          </div>
        }
        bottomDock={
          // 未绑定时挂载完整 Composer 会触发草稿预热；这里只复用输入壳，关闭所有会话 IO 入口。
          <ChatPromptEditor
            key={task.id}
            className="@container/composer chat-composer-input-surface w-full"
            workspacePath={task.workspacePath}
            workspaceIdentity={task.workspaceIdentity}
            taskId={null}
            disabled
            submitDisabled
            enableMentionPanel={false}
            enableSlashCommands={false}
            placeholder={status}
            submitLabel={intl.formatMessage({ id: "chat.send" })}
            inputTestId="work-task-pending-input"
            submitTestId="work-task-pending-send"
            leadingActions={<PendingTaskControls task={task} />}
            onSubmit={rejectSubmission}
          />
        }
      />
    </div>
  );
}
