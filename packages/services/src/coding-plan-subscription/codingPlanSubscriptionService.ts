import type { ApiClient } from "@zcode/shared";
import type { ICredentialService } from "../credential/credential.js";
import type { ICodingPlanSubscriptionService } from "./codingPlanSubscription.js";
import { BigModelCodingPlanSubscriptionProvider } from "./bigmodelCodingPlanSubscriptionProvider.js";
import type { ModelSelectionView } from "@zcode/provider";
import { ZaiCodingPlanSubscriptionProvider } from "./zaiCodingPlanSubscriptionProvider.js";

interface CodingPlanSubscriptionServiceDependencies {
  apiClient: ApiClient;
  credentialService: Pick<ICredentialService, "load">;
  resolveOffPeakModelSelectionView?: () => Promise<ModelSelectionView>;
}

/**
 * 原 service 把所有调用直接绑定到单一 BigModelCodingPlanSubscriptionProvider，
 * zai family 没有独立的 Team Plan 定价来源（死代码）。
 *
 * zai 与 bigmodel Team Plan 全链路对称化：
 * 同时持有 bigmodel 和 zai 两个 provider 实例；enterprise 读路径（getEnterprisePricing）按
 * request.family 路由到对应实例；缺省 family 时保持 bigmodel，向后兼容既有调用点。
 *
 * 其余平台配置沿用 bigmodel provider；应用不暴露购买和支付命令。
 */
export function createCodingPlanSubscriptionService(
  dependencies: CodingPlanSubscriptionServiceDependencies,
): ICodingPlanSubscriptionService {
  const bigmodelProvider = new BigModelCodingPlanSubscriptionProvider(dependencies);
  const zaiProvider = new ZaiCodingPlanSubscriptionProvider(dependencies);

  // 按 family 选择 enterprise 读路径 provider；缺省（含未指定 family 的历史调用）走 bigmodel。
  const resolveEnterprisePricingProvider = (
    family?: "bigmodel" | "zai",
  ): BigModelCodingPlanSubscriptionProvider => (family === "zai" ? zaiProvider : bigmodelProvider);

  return {
    getOffPeakClientConfig: (options) => bigmodelProvider.getOffPeakClientConfig(options),
    // 动态工作流灰度：与 client/configs 同源，
    // 因此和其它平台级配置一样固定走 bigmodel provider，与 family 无关。
    getDynamicWorkflowClientConfig: (options) =>
      bigmodelProvider.getDynamicWorkflowClientConfig(options),
    getModelContextBudgetStrategy: () => bigmodelProvider.getModelContextBudgetStrategy(),
    getForceUpdateConfig: () => bigmodelProvider.getForceUpdateConfig(),
    getEnterprisePricing: (request) =>
      resolveEnterprisePricingProvider(request?.family).getEnterprisePricing(),
  };
}
