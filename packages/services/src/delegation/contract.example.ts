import { uuidv7, type DelegationParent } from "@zcode/shared";
import type { IAgentDelegationService } from "./contract.js";

/** 小队沿用原会话身份和幂等准入，调用者只显式提供必要上下文。 */
export async function delegateSquadAnalysis(
  service: IAgentDelegationService,
  parent: DelegationParent,
) {
  const squad = (await service.listSquads())[0];
  if (!squad) return undefined;
  return service.delegateSquad({
    ...parent,
    squadId: squad.id,
    requestId: uuidv7(),
    title: "小队审查",
    task: "按成员职责审查当前模块，只汇报结果。",
    background: "",
    constraints: "不修改或提交",
    expectedResult: "结论和证据",
    intent: "analysis",
    dependsOn: [],
  });
}

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
