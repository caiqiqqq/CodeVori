import { useMemo } from "react";
import { CpuIcon, RefreshCw } from "lucide-react";
import { type WorkTask, type WorkTaskExecution } from "@zcode/shared";
import { useWorkTaskModels } from "@/hooks/useWorkTaskModels.js";
import { ModelConfigSelect } from "@/ModelConfigSelect.js";
import { AcpAgentIcon } from "@/components/AcpAgentIcon.js";
import { resolveModelDisplayName } from "@/lib/modelSelectionGroups.js";
import { resolveModelThoughtOption } from "@/lib/modelThoughtOption.js";
import { decodeCustomModelValue, encodeCustomModelValue } from "@/lib/zcodeCustomModelValue.js";
import { acpAgentFromModelValue, acpModelValue } from "@/v4/composer/acpModelSelection.js";
import { buildAcpModelSelectGroup } from "@/v4/composer/acpModelSelection.js";
import { AcpComposerConfigControls } from "@/v4/composer/AcpComposerConfigControls.js";
import { WorkTaskError, WorkTaskIconButton, useWorkTaskMessages } from "./WorkTaskParts.js";
import { WorkTaskApiConfigControls } from "./WorkTaskApiConfigControls.js";

interface Props {
  task: WorkTask | null;
  models: ReturnType<typeof useWorkTaskModels>;
  execution: WorkTaskExecution | null;
  busy: boolean;
  thought: ReturnType<typeof resolveModelThoughtOption> | null;
  changeExecution(execution: WorkTaskExecution): void;
  selectExecutor(execution: WorkTaskExecution): void;
}

export function WorkTaskExecutionControls({
  models,
  execution,
  busy,
  thought,
  changeExecution,
}: Omit<Props, "task" | "selectExecutor">) {
  const t = useWorkTaskMessages();
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
  // 修复原因：图标工具栏应与消息输入框顺序一致，不依赖 Host 目录返回顺序。
  const categories = ["mode", "collaboration_mode", "model", "thought_level", "model_config"];
  const orderedOptions = [...options].sort((a, b) => {
    const rank = (category?: string) => {
      const index = categories.indexOf(category ?? "");
      return index < 0 ? categories.length : index;
    };
    return rank(a.category) - rank(b.category);
  });
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
  return (
    <>
      {execution?.kind === "api" ? (
        <div className="contents">
          <div className="contents">
            <ModelConfigSelect
              modelGroups={models.apiGroups}
              normalizedValue={encodeCustomModelValue(
                execution.modelSelection.providerId,
                execution.modelSelection.modelId,
              )}
              triggerLabel={
                resolveModelDisplayName(
                  models.apiGroups,
                  encodeCustomModelValue(
                    execution.modelSelection.providerId,
                    execution.modelSelection.modelId,
                  ),
                ) ?? execution.modelSelection.modelId
              }
              tooltipTitle={`${t("apiModel")}: ${execution.modelSelection.modelId}`}
              showManageModelsAction={false}
              lockReasonMessage={t("executorLocked")}
              isItemLocked={() => false}
              onValueChange={(candidate) => {
                const model = decodeCustomModelValue(candidate);
                if (
                  model?.providerId === execution.modelSelection.providerId &&
                  model.modelName === execution.modelSelection.modelId
                )
                  return;
                if (model?.modelName)
                  changeExecution({
                    ...execution,
                    modelSelection: { providerId: model.providerId, modelId: model.modelName },
                  });
              }}
              disabled={busy}
              focusSelectorOnClose={null}
              triggerTestId="work-task-api-model"
              contentSide="bottom"
              triggerIcon={<CpuIcon className="size-4" />}
              triggerIconClassName="inline-flex"
              indicatorClassName="hidden"
              triggerLabelClassName="hidden"
              triggerClassName="size-7 justify-center p-0"
            />
          </div>
          <WorkTaskApiConfigControls
            execution={execution}
            thought={thought}
            disabled={busy}
            onChange={changeExecution}
          />
        </div>
      ) : agent ? (
        <div className="contents">
          <AcpComposerConfigControls
            agent={agent}
            className="contents"
            iconOnly
            options={orderedOptions}
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
              {t("configUnavailable")}
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
      {agent && models.configError ? (
        <div className="flex min-w-0 basis-full items-start gap-1">
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
    </>
  );
}

export function WorkTaskExecutorSelect({
  task,
  models,
  execution,
  busy,
  selectExecutor,
}: Pick<Props, "task" | "models" | "execution" | "busy" | "selectExecutor">) {
  const t = useWorkTaskMessages();
  const acpLabel = t("agents");
  const groups = useMemo(
    () => [
      {
        key: "execution-api",
        label: t("apiExecutor"),
        directItems: true,
        items: models.apiGroups.some((group) => group.items.length)
          ? [{ key: "api", value: "api", name: t("apiExecutor") }]
          : [],
      },
      buildAcpModelSelectGroup(acpLabel, models.agents),
    ],
    [models.apiGroups, models.agents, acpLabel],
  );
  const value = execution?.kind === "acp" ? acpModelValue(execution.agent) : execution ? "api" : "";
  const agent = execution?.kind === "acp" ? execution.agent : null;
  const lockedExecutor = !!task && task.runSeq > 0;
  const selectModel = (candidate: string) => {
    if (candidate === value && execution) {
      selectExecutor(execution);
      return;
    }
    const nextAgent = acpAgentFromModelValue(candidate);
    if (nextAgent) {
      selectExecutor({ kind: "acp", agent: nextAgent, config: [] });
    } else if (candidate === "api" && models.view?.preferredSelection) {
      selectExecutor({
        kind: "api",
        mode: "build",
        modelSelection: models.view.preferredSelection,
      });
    }
  };
  return (
    <div className="contents">
      <ModelConfigSelect
        modelGroups={groups}
        renderItemIcon={(item) => {
          const itemAgent = acpAgentFromModelValue(item.value);
          return itemAgent ? <AcpAgentIcon agent={itemAgent} /> : null;
        }}
        normalizedValue={value}
        triggerIcon={agent ? <AcpAgentIcon agent={agent} /> : undefined}
        triggerIconClassName={agent ? "inline-flex" : "hidden"}
        triggerLabel={resolveModelDisplayName(groups, value) ?? t("selectModel")}
        tooltipTitle={`${t("executor")}: ${resolveModelDisplayName(groups, value) ?? t("selectModel")}`}
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
        triggerLabelClassName="min-w-0 truncate text-left"
        triggerClassName="max-w-40"
      />
    </div>
  );
}
