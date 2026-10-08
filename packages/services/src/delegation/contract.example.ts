import { uuidv7, type DelegationParent } from "@zcode/shared";
import type { IAgentDelegationService } from "./contract.js";

/** Public service example: callers provide context; only the coordinator accepts execution. */
export async function delegateAnalysis(service: IAgentDelegationService, parent: DelegationParent) {
  const target = (await service.targets()).find(
    (agent) => agent.kind === "acp" && agent.agent === "claude",
  );
  if (!target || target.kind !== "acp") return undefined;
  return service.delegate({
    ...parent,
    requestId: uuidv7(),
    title: "接口审查",
    task: "审查接口，报告问题与证据，不修改文件。",
    execution: { kind: "acp", agent: target.agent, config: [] },
    intent: "analysis",
    background: "",
    constraints: "不提交或推送",
    expectedResult: "问题、位置和验证结果",
    dependsOn: [],
  });
}
