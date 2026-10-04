import { useMemo, useRef, useState } from "react";
import { RefreshCw, Save } from "lucide-react";
import {
  type WorkTask,
  type WorkTaskCreate,
  type WorkTaskExecution,
  type WorkTaskScope,
} from "@zcode/shared";
import { useWorkTaskModels } from "@/hooks/useWorkTaskModels.js";
import {
  resolveWorkTaskExecutionPreference,
  workTaskExecutionPreferenceStore,
} from "@/store/workTaskExecutionPreferenceStore.js";
import { ModelConfigSelect } from "@/ModelConfigSelect.js";
import { resolveModelDisplayName } from "@/lib/modelSelectionGroups.js";
import { resolveModelThoughtOption } from "@/lib/modelThoughtOption.js";
import { decodeCustomModelValue, encodeCustomModelValue } from "@/lib/zcodeCustomModelValue.js";
import { acpAgentFromModelValue, acpModelValue } from "@/v4/composer/acpModelSelection.js";
import { buildAcpModelSelectGroup } from "@/v4/composer/acpModelSelection.js";
import { AcpComposerConfigControls } from "@/v4/composer/AcpComposerConfigControls.js";
import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";
import { Textarea } from "@/components/ui/textarea.js";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.js";
import { WorkTaskError, WorkTaskIconButton, useWorkTaskMessages } from "./WorkTaskParts.js";

interface Props {
  scope: WorkTaskScope;
  task: WorkTask | null;
  busy: boolean;
  error: string | null;
  startAfterSave?: boolean;
  onClose(): void;
  onSave(draft: Omit<WorkTaskCreate, keyof WorkTaskScope>): Promise<boolean>;
}

export function WorkTaskEditor({
  scope,
  task,
  busy,
  error,
  startAfterSave = false,
  onClose,
  onSave,
}: Props) {
  const t = useWorkTaskMessages();
  const models = useWorkTaskModels(scope);
  const [title, setTitle] = useState(task?.title ?? "");
  const [prompt, setPrompt] = useState(task?.prompt ?? "");
  const submitting = useRef(false);
  const [draftExecution, setDraftExecution] = useState<WorkTaskExecution | null>(
    task?.execution ?? null,
  );
  // 修复原因：弹窗卸载会丢失选择；新建读取主动保存的偏好，历史任务仍以自身配置为准。
  const [rememberedExecution] = useState(() =>
    task ? null : workTaskExecutionPreferenceStore.getState().read(scope),
  );
  const execution: WorkTaskExecution | null =
    draftExecution ??
    resolveWorkTaskExecutionPreference(rememberedExecution, models.view, models.agents);
  const acpLabel = t("agents");
  const groups = useMemo(
    () => [...models.apiGroups, buildAcpModelSelectGroup(acpLabel, models.agents)],
    [models.apiGroups, models.agents, acpLabel],
  );
  const value =
    execution?.kind === "acp"
      ? acpModelValue(execution.agent)
      : execution
        ? encodeCustomModelValue(
            execution.modelSelection.providerId,
            execution.modelSelection.modelId,
          )
        : "";
  const agent = execution?.kind === "acp" ? execution.agent : null;
  const known = agent ? models.configs.find((snapshot) => snapshot.agent === agent) : null;
  const options =
    execution?.kind === "acp"
      ? (known?.configOptions ?? []).map((option) => {
          const saved = execution.config.find((item) => item.configId === option.id);
          return option.type === "boolean"
            ? {
                ...option,
                currentValue: typeof saved?.value === "boolean" ? saved.value : option.currentValue,
              }
            : {
                ...option,
                currentValue: typeof saved?.value === "string" ? saved.value : option.currentValue,
              };
        })
      : [];
  const modes =
    execution?.kind === "acp" && known?.modeState
      ? {
          ...known.modeState,
          currentModeId: String(
            execution.config.find((item) => item.configId === "mode")?.value ??
              known.modeState.currentModeId,
          ),
        }
      : null;
  const thought =
    execution?.kind === "api" && models.view
      ? resolveModelThoughtOption({
          modelSelectionView: models.view,
          providerId: execution.modelSelection.providerId,
          modelId: execution.modelSelection.modelId,
          currentValue: execution.modelSelection.options?.reasoningLevel,
        })
      : null;
  const lockedExecutor = !!task && task.runSeq > 0;
  const changeExecution = (next: WorkTaskExecution) => {
    setDraftExecution(next);
    // 偏好只由主动选择写入，目录刷新和编辑旧任务不能改变下次新建配置。
    if (!task) workTaskExecutionPreferenceStore.getState().remember(scope, next);
  };
  const selectModel = (candidate: string) => {
    if (candidate === value && execution) {
      changeExecution(execution);
      return;
    }
    const nextAgent = acpAgentFromModelValue(candidate);
    if (nextAgent) {
      changeExecution({ kind: "acp", agent: nextAgent, config: [] });
    } else {
      const model = decodeCustomModelValue(candidate);
      if (!model?.modelName) return;
      changeExecution({
        kind: "api",
        mode: execution?.kind === "api" ? execution.mode : "build",
        modelSelection: { providerId: model.providerId, modelId: model.modelName },
      });
    }
  };
  const updateAcpOption = async (configId: string, value: string | boolean) => {
    if (execution?.kind !== "acp") return;
    changeExecution({
      ...execution,
      config: [
        ...execution.config.filter((item) => item.configId !== configId),
        { configId, value },
      ],
    });
  };
  const useAgentDefault = async (configId: string) => {
    if (execution?.kind !== "acp") return;
    changeExecution({
      ...execution,
      config: execution.config.filter((item) => item.configId !== configId),
    });
  };
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!execution || busy || submitting.current) return;
    // React 提交忙碌状态前仍可能连续 submit；同步锁覆盖保存和重新开始的完整操作。
    submitting.current = true;
    try {
      // 修复原因：历史快照只提供目录，保存全部历史当前值会继承别的会话的高权限。
      // 未显式选择的项留给实际 Agent 默认值，已保存的未知选项也不能悄悄丢弃。
      if (await onSave({ title: title.trim(), prompt: prompt.trim(), execution })) onClose();
    } finally {
      submitting.current = false;
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent
        aria-describedby={undefined}
        className="max-h-[85vh] max-w-xl overflow-y-auto"
        data-testid="work-task-editor"
      >
        <DialogHeader>
          <DialogTitle>{t(task ? "edit" : "create")}</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            void save(event);
          }}
          className="flex min-w-0 flex-col gap-4"
        >
          <label className="flex min-w-0 flex-col gap-1.5 text-ui-sm text-foreground-subtle">
            {t("taskTitle")}
            <Input
              data-testid="work-task-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              maxLength={200}
              required
              disabled={busy}
            />
          </label>
          <label className="flex min-w-0 flex-col gap-1.5 text-ui-sm text-foreground-subtle">
            {t("project")}
            <span className="break-all font-mono">{scope.workspacePath}</span>
          </label>
          <div className="flex min-w-0 flex-col gap-1.5">
            <span className="text-ui-sm text-foreground-subtle">{t("executor")}</span>
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <ModelConfigSelect
                modelGroups={groups}
                normalizedValue={value}
                triggerLabel={resolveModelDisplayName(groups, value) ?? t("selectModel")}
                showManageModelsAction={false}
                lockReasonMessage={t("executorLocked")}
                isItemLocked={(candidate) =>
                  lockedExecutor &&
                  (task?.execution.kind === "acp"
                    ? candidate !== acpModelValue(task.execution.agent)
                    : !!acpAgentFromModelValue(candidate))
                }
                onValueChange={selectModel}
                onOpenChange={(open) => {
                  if (open) {
                    models.refreshAgents();
                    void models.refreshConfigs();
                  }
                }}
                disabled={busy}
                focusSelectorOnClose={null}
                triggerTestId="work-task-model"
                contentSide="bottom"
                labelVisibilityClassName="inline-flex min-w-0 truncate"
                triggerClassName="max-w-full"
              />
              {execution?.kind === "api" ? (
                <>
                  <Select
                    value={execution.mode}
                    onValueChange={(mode) =>
                      changeExecution({
                        ...execution,
                        mode: mode as "build" | "edit" | "plan" | "yolo",
                      })
                    }
                    disabled={busy}
                  >
                    <SelectTrigger className="max-w-40" aria-label={t("mode")}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {["build", "edit", "plan", "yolo"].map((mode) => (
                        <SelectItem key={mode} value={mode}>
                          {t(`mode.${mode}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {thought?.options?.length ? (
                    <Select
                      value={execution.modelSelection.options?.reasoningLevel ?? ""}
                      onValueChange={(level) =>
                        changeExecution({
                          ...execution,
                          modelSelection: {
                            ...execution.modelSelection,
                            options: { reasoningLevel: level },
                          },
                        })
                      }
                      disabled={busy}
                    >
                      <SelectTrigger className="max-w-40" aria-label={t("reasoning")}>
                        <SelectValue placeholder={t("reasoning")} />
                      </SelectTrigger>
                      <SelectContent>
                        {thought.options.map((item) => (
                          <SelectItem key={item.value} value={item.value}>
                            {item.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : null}
                </>
              ) : agent ? (
                <div className="min-w-0 [&>div]:flex-wrap">
                  <AcpComposerConfigControls
                    agent={agent}
                    options={options}
                    modes={modes}
                    disabled={busy}
                    loading={models.configStatus === "loading" && !options.length && !modes}
                    onChange={updateAcpOption}
                    defaultOption={{
                      label: t("agentDefault"),
                      selectedIds: (options.length
                        ? options.map((option) => option.id)
                        : modes
                          ? ["mode"]
                          : []
                      ).filter(
                        (id) =>
                          execution?.kind === "acp" &&
                          !execution.config.some((item) => item.configId === id),
                      ),
                      onSelect: useAgentDefault,
                    }}
                    focusSelectorOnClose={null}
                  />
                  {models.configStatus !== "loading" &&
                  !options.length &&
                  !modes &&
                  execution?.kind === "acp" &&
                  !execution.config.length ? (
                    <span
                      data-testid="work-task-agent-default"
                      className="text-ui-sm text-foreground-subtle"
                    >
                      {t("agentDefault")}
                    </span>
                  ) : null}
                  {execution?.kind === "acp"
                    ? execution.config
                        .filter(
                          (item) =>
                            !options.some((option) => option.id === item.configId) &&
                            !(item.configId === "mode" && modes),
                        )
                        .map((item) => (
                          <span
                            key={item.configId}
                            className="break-all font-mono text-ui-sm text-foreground-subtle"
                          >
                            {item.configId}: {String(item.value)}
                          </span>
                        ))
                    : null}
                </div>
              ) : null}
            </div>
            {agent && models.configError ? (
              <div className="flex min-w-0 items-start gap-1">
                <WorkTaskError error={t("configReadFailed", { message: models.configError })} />
                <WorkTaskIconButton
                  label={t("configRetry")}
                  data-testid="work-task-config-retry"
                  disabled={busy}
                  onClick={() => {
                    void models.refreshConfigs();
                  }}
                >
                  <RefreshCw className="size-4" />
                </WorkTaskIconButton>
              </div>
            ) : null}
          </div>
          <label className="flex min-w-0 flex-col gap-1.5 text-ui-sm text-foreground-subtle">
            {t("prompt")}
            <Textarea
              data-testid="work-task-prompt"
              className="h-40 field-sizing-fixed resize-y border-input-border bg-input text-foreground"
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              required
              maxLength={100000}
              disabled={busy}
            />
          </label>
          <WorkTaskError error={error} />
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
              {t("close")}
            </Button>
            <Button
              type="submit"
              disabled={
                busy ||
                !title.trim() ||
                !prompt.trim() ||
                !execution ||
                (!!thought?.options?.length && !thought.currentValue)
              }
              data-testid="work-task-save"
            >
              <Save className="size-4" />
              {t(task && startAfterSave ? "saveAndStart" : "save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
