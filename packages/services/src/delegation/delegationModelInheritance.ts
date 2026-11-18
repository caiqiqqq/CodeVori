import type {
  AcpAgentConfigSnapshot,
  AcpConfigOption,
  AcpSession,
  WorkTaskExecution,
} from "@zcode/shared";

export type DelegationAcpModelSelection = {
  agent: AcpSession["agent"];
  configId: string;
  value: string;
};

type AcpExecution = Extract<WorkTaskExecution, { kind: "acp" }>;
type AcpModelOption = Extract<AcpConfigOption, { type: "select" }>;

function isModelOption(option: AcpConfigOption): option is AcpModelOption {
  return option.type === "select" && (option.category === "model" || option.id === "model");
}

function modelOptionValues(option: AcpModelOption): string[] {
  return option.options
    .flatMap((item) => ("group" in item ? item.options : [item]))
    .map((item) => item.value);
}

export function readDelegationAcpModelSelection(
  session: Pick<AcpSession, "agent" | "configOptions">,
): DelegationAcpModelSelection | undefined {
  const option = session.configOptions.find(isModelOption);
  if (!option?.currentValue) return undefined;
  return { agent: session.agent, configId: option.id, value: option.currentValue };
}

export function resolveDelegationAcpExecution(
  execution: AcpExecution,
  parentModel: DelegationAcpModelSelection | undefined,
  targetPreference: { configId: string; value: string } | undefined,
  targetConfig: AcpAgentConfigSnapshot | undefined,
): AcpExecution {
  const targetModel =
    targetConfig?.agent === execution.agent
      ? targetConfig.configOptions.find(isModelOption)
      : undefined;
  const explicitModel =
    targetModel && execution.config.some((item) => item.configId === targetModel.id);
  if (explicitModel) return execution;

  if (
    targetModel &&
    parentModel &&
    targetModel.id === parentModel.configId &&
    modelOptionValues(targetModel).includes(parentModel.value)
  ) {
    return {
      ...execution,
      config: [...execution.config, { configId: targetModel.id, value: parentModel.value }],
    };
  }

  return targetPreference ? { ...execution, modelPreference: targetPreference } : execution;
}
