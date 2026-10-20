import { useRef, useState } from "react";
import { Save } from "lucide-react";
import {
  type WorkTask,
  type WorkTaskCreate,
  type WorkTaskExecution,
  type WorkTaskScope,
} from "@zcode/shared";
import { useWorkTaskModels } from "@/hooks/useWorkTaskModels.js";
import { useWorkTaskBranches } from "@/hooks/useWorkTaskBranches.js";
import { WorkTaskBranchSelect } from "./WorkTaskBranchSelect.js";
import { useWorkTaskPromptAssets } from "@/hooks/useWorkTaskPromptAssets.js";
import { useWorkTaskEditorSave } from "@/hooks/useWorkTaskEditorSave.js";
import type { LexicalChatInputHandle } from "@/LexicalChatInput.js";
import {
  resolveWorkTaskExecutionPreference,
  workTaskExecutionPreferenceStore,
} from "@/store/workTaskExecutionPreferenceStore.js";
import { resolveModelThoughtOption } from "@/lib/modelThoughtOption.js";
import { Button } from "@/components/ui/button.js";
import { Switch } from "@/components/ui/switch.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.js";
import type { WorkspaceTabState } from "@/store/tabStore.js";
import { workTaskNavigationKey } from "@/store/workTaskNavigationStore.js";
import { workTaskProjectOptions } from "@/lib/workTaskProjectOptions.js";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog.js";
import { WorkTaskError, useWorkTaskMessages } from "./WorkTaskParts.js";
import { WorkTaskPromptField } from "./WorkTaskPromptField.js";
import { WorkTaskExecutionControls, WorkTaskExecutorSelect } from "./WorkTaskExecutionControls.js";

interface Props {
  scope: WorkTaskScope;
  projectOptions?: readonly WorkspaceTabState[];
  onProjectChange?(key: string): void;
  task: WorkTask | null;
  initialDraft?: Pick<WorkTaskCreate, "title" | "prompt"> & { attachmentFiles?: File[] };
  busy: boolean;
  error: string | null;
  startAfterSave?: boolean;
  onClose(): void;
  onSave(draft: Omit<WorkTaskCreate, keyof WorkTaskScope>): Promise<boolean>;
}

export function WorkTaskEditor({
  scope,
  projectOptions,
  onProjectChange,
  task,
  initialDraft,
  busy: externalBusy,
  error,
  startAfterSave = false,
  onClose,
  onSave,
}: Props) {
  const t = useWorkTaskMessages();
  const models = useWorkTaskModels(scope);
  const lockedWorkspace = !!(task?.worktree || task?.directBranch);
  const branches = useWorkTaskBranches(scope, !lockedWorkspace);
  const [sourceDraft, setSourceDraft] = useState<{ value?: string } | null>(
    task ? { value: task.sourceBranch } : null,
  );
  const sourceBranch = sourceDraft ? sourceDraft.value : branches.currentBranch;
  const [useWorktree, setUseWorktree] = useState(task?.useWorktree !== false);
  const [prompt, setPrompt] = useState(task?.prompt ?? initialDraft?.prompt ?? "");
  const submission = useWorkTaskEditorSave(externalBusy);
  const { busy } = submission;
  const inputApiRef = useRef<LexicalChatInputHandle | null>(null);
  const assets = useWorkTaskPromptAssets(scope, task, busy, initialDraft?.attachmentFiles);
  const [draftExecution, setDraftExecution] = useState<WorkTaskExecution | null>(
    task?.execution ?? null,
  );
  const executionDrafts = useRef(new Map<string, WorkTaskExecution>());
  // 修复原因：弹窗卸载会丢失选择；新建读取主动保存的偏好，历史任务仍以自身配置为准。
  const [rememberedExecution] = useState(() =>
    task ? null : workTaskExecutionPreferenceStore.getState().read(scope),
  );
  const execution: WorkTaskExecution | null =
    draftExecution ??
    resolveWorkTaskExecutionPreference(rememberedExecution, models.view, models.agents);
  const thought =
    execution?.kind === "api" && models.view
      ? resolveModelThoughtOption({
          modelSelectionView: models.view,
          providerId: execution.modelSelection.providerId,
          modelId: execution.modelSelection.modelId,
          currentValue: execution.modelSelection.options?.reasoningLevel,
        })
      : null;
  const changeExecution = (next: WorkTaskExecution) => {
    setDraftExecution(next);
    // 偏好只由主动选择写入，目录刷新和编辑旧任务不能改变下次新建配置。
    if (!task) workTaskExecutionPreferenceStore.getState().remember(scope, next);
  };
  const selectExecutor = (next: WorkTaskExecution) => {
    const key = (value: WorkTaskExecution) => (value.kind === "acp" ? `acp:${value.agent}` : "api");
    // 修复原因：切换执行器不能丢失已选模式/模型，也不能把旧 Agent 覆盖带给新 Agent。
    // 暂存仅属于本弹窗；当前 execution 仍是唯一保存来源。
    if (execution) executionDrafts.current.set(key(execution), execution);
    changeExecution(executionDrafts.current.get(key(next)) ?? next);
  };
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!execution || !inputApiRef.current) return;
    await submission.submit(async (signal) => {
      // 修复原因：历史快照只提供目录，保存全部历史当前值会继承别的会话的高权限。
      // 未显式选择的项留给实际 Agent 默认值，已保存的未知选项也不能悄悄丢弃。
      if (!inputApiRef.current) return;
      const title =
        task?.title ??
        initialDraft?.title ??
        inputApiRef.current.getMarkdown().trim().replace(/\s+/g, " ").slice(0, 200);
      const draft = await assets.prepareDraft(title, execution, inputApiRef.current, signal);
      if (
        (await onSave({ ...draft, useWorktree, ...(sourceBranch ? { sourceBranch } : {}) })) &&
        !signal.aborted
      )
        onClose();
    });
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
          <div className="flex min-w-0 flex-col gap-1.5 text-ui-sm text-foreground-subtle">
            {t("project")}
            {!task && projectOptions ? (
              <Select
                value={workTaskNavigationKey(scope)}
                onValueChange={onProjectChange}
                disabled={busy}
              >
                <SelectTrigger
                  aria-label={t("project")}
                  data-testid="work-task-editor-project"
                  className="w-full min-w-0"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {workTaskProjectOptions(projectOptions).map(({ tab, label, description }) => (
                    <SelectItem key={workTaskNavigationKey(tab)} value={workTaskNavigationKey(tab)}>
                      <span title={description ?? tab.workspacePath}>
                        {label}
                        {description ? ` · ${description}` : ""}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null}
            <span className="break-all font-mono">{scope.workspacePath}</span>
          </div>
          <div className="flex min-w-0 flex-col gap-1.5">
            <span className="text-ui-sm text-foreground-subtle">{t("sourceBranch")}</span>
            <WorkTaskBranchSelect
              label={t("sourceBranch")}
              value={sourceBranch}
              branches={branches.branches}
              allowHead={useWorktree}
              testId="work-task-source-branch"
              disabled={busy || lockedWorkspace || branches.loading}
              onChange={(value) => setSourceDraft({ value })}
              onOpen={() => {
                void branches.refresh();
              }}
            />
            <WorkTaskError error={branches.error} />
            {branches.error ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="self-start"
                onClick={() => {
                  void branches.refresh();
                }}
              >
                {t("branchRetry")}
              </Button>
            ) : null}
          </div>
          <div className="flex min-w-0 flex-col gap-1.5">
            <label
              className="flex items-center justify-between gap-3 text-ui-sm"
              htmlFor="work-task-use-worktree"
            >
              {t("useWorktree")}
              <Switch
                id="work-task-use-worktree"
                data-testid="work-task-use-worktree"
                checked={useWorktree}
                disabled={busy || lockedWorkspace}
                onCheckedChange={(checked) => {
                  setUseWorktree(checked);
                  if (!checked && !sourceBranch) setSourceDraft({ value: branches.currentBranch });
                }}
              />
            </label>
            <p className="text-ui-sm text-foreground-subtle">
              {t(useWorktree ? "worktreeHint" : "directBranchHint")}
            </p>
          </div>

          <WorkTaskPromptField
            scope={scope}
            task={task}
            initialPrompt={initialDraft?.prompt}
            busy={busy}
            assets={assets}
            inputApiRef={inputApiRef}
            onChange={setPrompt}
            // 修复原因：任务输入区复用消息框的左右工具栏，图标配置与智能体选择分别进入原插槽。
            trailingActions={
              <WorkTaskExecutorSelect
                task={task}
                models={models}
                execution={execution}
                busy={busy}
                selectExecutor={selectExecutor}
              />
            }
            leadingActions={
              <div
                role="group"
                className="contents"
                aria-label={t("executionConfig")}
                data-testid="work-task-execution-config"
              >
                <WorkTaskExecutionControls
                  models={models}
                  execution={execution}
                  busy={busy}
                  thought={thought}
                  changeExecution={changeExecution}
                />
              </div>
            }
          />
          <p className="text-ui-sm text-foreground-subtle">{t("executionConfigHint")}</p>
          <WorkTaskError error={submission.error ?? assets.attachmentError ?? error} />
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
              {t("close")}
            </Button>
            <Button
              type="submit"
              disabled={
                busy ||
                !prompt.trim() ||
                (!useWorktree && !sourceBranch) ||
                !execution ||
                (!lockedWorkspace && (branches.loading || !!branches.error)) ||
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
