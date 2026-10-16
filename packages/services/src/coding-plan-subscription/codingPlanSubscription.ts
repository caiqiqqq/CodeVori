import type {
  EnterpriseCodingPlanPricingRequest,
  EnterpriseCodingPlanPricingResponse,
  ZCodeModelContextBudgetStrategy,
  ForceUpdateConfig,
  DynamicWorkflowClientConfig,
} from "@zcode/shared";
import type { ModelSelectionView } from "@zcode/provider";
import { ServiceChannels } from "@zcode/shared";
import { createServiceDescriptor } from "../descriptors.js";

export interface OffPeakClientConfig {
  readonly enabled: boolean;
  readonly modelSelectionView: ModelSelectionView;
  /** mock 演示强制通道：真实路径不下发，UI 使用 Host 的 Account support。 */
  readonly codingPlanActive?: boolean;
}

export interface ICodingPlanSubscriptionService {
  /** 闲时任务灰度配置：forceRefresh 供入口打开时补拉（绕过 1h 快照缓存）。 */
  getOffPeakClientConfig(options?: { forceRefresh?: boolean }): Promise<OffPeakClientConfig>;
  /**
   * Host 本地工作流策略，默认开启；合法环境变量覆盖。
   * forceRefresh 仅保留接口兼容，不发网络请求。
   */
  getDynamicWorkflowClientConfig(options?: {
    forceRefresh?: boolean;
  }): Promise<DynamicWorkflowClientConfig>;
  /** 兼容接口：固定返回 preflight-v1，不读取远端配置或缓存。 */
  getModelContextBudgetStrategy(): Promise<ZCodeModelContextBudgetStrategy>;
  getForceUpdateConfig(): Promise<ForceUpdateConfig | null>;
  getEnterprisePricing(
    request?: EnterpriseCodingPlanPricingRequest,
  ): Promise<EnterpriseCodingPlanPricingResponse>;
}

export const ICodingPlanSubscriptionService =
  createServiceDescriptor<ICodingPlanSubscriptionService>(ServiceChannels.CodingPlanSubscription);
