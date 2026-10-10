import { useMemo } from "react";
import { RefreshCw } from "lucide-react";
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
  task,
  models,
  execution,
  busy,
  thought,
  changeExecution,
  selectExecutor,
}: Props) {
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
      <div className="flex min-w-0 flex-col gap-1.5">
        <span className="text-ui-sm text-foreground-subtle">{t("executor")}</span>
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
          triggerLabelClassName="min-w-0 flex-1 truncate text-left"
          triggerClassName="h-9 w-full max-w-full justify-between rounded-lg border border-input-border bg-input px-3 text-ui-base"
        />
      </div>
      {execution?.kind === "api" ? (
        <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="flex min-w-0 flex-col gap-1.5 sm:col-span-2">
            <span className="text-ui-sm text-foreground-subtle">{t("apiModel")}</span>
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
              triggerIconClassName="hidden"
              triggerLabelClassName="min-w-0 flex-1 truncate text-left"
              triggerClassName="h-9 w-full max-w-full justify-between rounded-lg border border-input-border bg-input px-3 text-ui-base"
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
        <div className="min-w-0 max-w-full">
          <AcpComposerConfigControls
            agent={agent}
            presentation="fields"
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
