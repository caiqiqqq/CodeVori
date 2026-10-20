import { completeNewModelSelection } from "@zcode/provider";
import { delegationAgentsSchema, type DelegationApiAgent } from "@zcode/shared";
import type { IModelSelectionService } from "../model-provider/providerFacadeServices.js";
import type { DelegationDependencies } from "./contract.js";

export async function listApiDelegationTargets(source: Pick<IModelSelectionService, "getView">) {
  // 使用模型选择的已发布 Registry，不读取设置草稿，也不向委派目录暴露凭据。
  const view = await source.getView();
  const targets: DelegationApiAgent[] = [];
  for (const provider of view.providers) {
    if (!provider.config.api?.type) continue;
    for (const model of provider.models) {
      const modelSelection = completeNewModelSelection(view, {
        providerId: provider.providerId,
        modelId: model.modelId,
      });
      if (!modelSelection) continue;
      targets.push({
        kind: "api",
        providerName: provider.providerName || provider.providerId,
        execution: { kind: "api", modelSelection, mode: "build" },
        reasoningLevels: [...model.config.optionSpecs.reasoningLevel.values],
      });
    }
  }
  return targets;
}

export async function listDelegationTargets(
  deps: Pick<DelegationDependencies, "targets" | "apiTargets">,
) {
  const [acp, api] = await Promise.all([deps.targets(), deps.apiTargets?.() ?? []]);
  return delegationAgentsSchema
    .parse([...acp, ...api])
    .filter((target) => target.kind === "api" || (target.enabled && target.ready));
}
