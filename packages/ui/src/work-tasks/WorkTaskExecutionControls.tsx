import { useMemo } from "react";
import { RefreshCw } from "lucide-react";
import { type WorkTask, type WorkTaskExecution } from "@zcode/shared";
import { useWorkTaskModels } from "@/hooks/useWorkTaskModels.js";
import { ModelConfigSelect } from "@/ModelConfigSelect.js";
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
}

export function WorkTaskExecutionControls({
  task,
  models,
  execution,
  busy,
  thought,
  changeExecution,
}: Props) {
  const t = useWorkTaskMessages();
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
  const lockedExecutor = !!task && task.runSeq > 0;
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
  return (
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
          <WorkTaskApiConfigControls
            execution={execution}
            thought={thought}
            disabled={busy}
            onChange={changeExecution}
          />
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
  );
}
