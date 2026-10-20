import { BUILTIN_MODEL_PROVIDER_IDS, resolveZaiBusinessBaseUrl } from "@zcode/shared";
import type { CodingPlanSubscriptionProviderId } from "@zcode/shared";
import {
  BigModelCodingPlanSubscriptionProvider,
  createZaiLoginAuthHeaders,
} from "./bigmodelCodingPlanSubscriptionProvider.js";

/**
 * ZaiCodingPlanSubscriptionProvider
 *
 * 历史上 Team Plan 企业定价只在 bigmodel family 上落地，service 层把所有
 * enterprise 读请求直接打到 BigModelCodingPlanSubscriptionProvider，硬编码 bigmodel
 * 域名 + bigmodelCodingPlan providerId + bigmodel OAuth token。zai family 即使生成
 * 了 team plan 连接键，也无独立的定价数据来源（死代码）。
 *
 * zai 与 bigmodel Team Plan 全链路对称化：
 * 本类继承 BigModelCodingPlanSubscriptionProvider，仅覆盖 enterprise 读路径的 family 维度：
 *   - providerId  → zaiCodingPlan
 *   - 业务域名   → resolveZaiCodingPlanHost()（测试 配置的 ZAI Business origin / 线上 api.z.ai）
 *   - OAuth token → loadZaiAuthorization()（oauth:zai:access_token，复用父类）
 *   - 鉴权头     → createZaiLoginAuthHeaders()
 *
 * 覆盖范围：getEnterprisePricing + enrichEnterprisePricingTeamProjects 相关的
 * family 维度（通过 protected 虚方法）；client/configs 是平台级，与 family 无关。
 */
export class ZaiCodingPlanSubscriptionProvider extends BigModelCodingPlanSubscriptionProvider {
  protected codingPlanProviderId(): CodingPlanSubscriptionProviderId {
    return BUILTIN_MODEL_PROVIDER_IDS.zaiIndividualCodingPlan;
  }

  protected resolveFamilyEnterpriseHost(): string {
    return resolveZaiCodingPlanHost();
  }

  protected async loadFamilyEnterpriseToken(): Promise<string> {
    // 复用父类 loadZaiAuthorization：credential key = oauth:zai:access_token。
    return this.loadZaiAuthorization();
  }

  protected createFamilyEnterpriseAuthHeaders(token: string): Record<string, string> {
    return createZaiLoginAuthHeaders(token);
  }
}

/**
 * zai 业务域名：跟随产品环境（测试配置的 ZAI Business origin / 线上 api.z.ai）。
 */
function resolveZaiCodingPlanHost(): string {
  return resolveZaiBusinessBaseUrl(process.env);
}
