/* eslint-disable max-lines -- Coding Plan provider 集中处理平台配置与已有团队套餐读取。 */
import type {
  ApiClient,
  ApiRequestInit,
  ForceUpdateConfig,
  CodingPlanSubscriptionProviderId,
  EnterpriseCodingPlanPricingResponse,
  EnterpriseCodingPlanPricingProduct,
  EnterpriseCodingPlanProjectApiKeyUnavailableReason,
  EnterpriseCodingPlanProjectContext,
  ZCodeModelContextBudgetStrategy,
  DynamicWorkflowClientConfig,
} from "@zcode/shared";
import type { ModelSelectionView } from "@zcode/provider";
import type { OffPeakClientConfig } from "./codingPlanSubscription.js";
import {
  BIGMODEL_PROVIDER_ID,
  BUILTIN_MODEL_PROVIDER_IDS,
  CODING_PLAN_SYSTEM_BUSY,
  buildRuntimeZCodeApiUrl,
  isZaiCodingPlanProviderId,
  resolveBigModelApiOrigin,
  ZAI_PROVIDER_ID,
  ZCODE_VERSION,
  DEFAULT_ZCODE_MODEL_CONTEXT_BUDGET_STRATEGY,
  createDynamicWorkflowClientConfig,
  normalizeDynamicWorkflowMode,
  resolveDynamicWorkflowClientConfig,
  DEFAULT_DYNAMIC_WORKFLOW_MODE,
  ZCODE_DYNAMIC_WORKFLOW_MODE_ENV,
} from "@zcode/shared";
import type { ICredentialService } from "../credential/credential.js";
import { readApiJson } from "../providers/api/apiJson.js";
import { createServiceLogger } from "../logger/serviceLogger.js";
import {
  ensureBigModelTeamPlanProjectApiKeyWithStatus,
  type BigModelTeamPlanApiKeyEnsureResult,
  type BigModelTeamPlanBizContext,
} from "#src/bigmodel/teamPlanApiKey.js";

const BIGMODEL_CODING_PLAN_API_PREFIX = "/api/biz";
const ZCODE_CLIENT_CONFIG_API_PREFIX = "/api/v1/client/configs";
const REQUEST_TIMEOUT_MS = 15_000;
const CLIENT_CONFIG_CACHE_TTL_MS = 60 * 60 * 1000;
const ZCODE_JWT_TOKEN_KEY = "zcodejwttoken";
const log = createServiceLogger("codingPlanSubscription");

interface RemoteEnvelope<T> {
  code?: number;
  msg?: string;
  success?: boolean;
  data?: T | null;
}

interface ZCodeClientConfigEnvelope {
  code?: number;
  msg?: string;
  success?: boolean;
  data?: {
    configs?: {
      forceUpdate?: ForceUpdateConfig | null;
      // 闲时任务灰度（服务端）：内层字段服务端为 snake_case，与外层 camelCase 混排。
      offPeak?: {
        enable_offpeak_task?: boolean;
      } | null;
      modelContextBudget?: {
        strategy?: unknown;
      } | null;
      // 动态工作流灰度：mode 的取值域由
      // shared 的 normalizeDynamicWorkflowMode 裁决，这里保持 unknown，不在类型层假设服务端合法。
      dynamicWorkflow?: {
        mode?: unknown;
      } | null;
    } | null;
  } | null;
}

interface BigModelCodingPlanSubscriptionProviderOptions {
  apiClient: ApiClient;
  credentialService: Pick<ICredentialService, "load">;
  resolveOffPeakModelSelectionView?: () => Promise<ModelSelectionView>;
}

interface TeamPlanProjectApiKeyPrewarmStatus {
  status: "available" | "unavailable";
  reason?: EnterpriseCodingPlanProjectApiKeyUnavailableReason;
  message?: string | null;
}

interface BigModelCustomerInfoResponse {
  organizations?: Array<{
    organizationId?: string | null;
    organizationName?: string | null;
    projects?: Array<{
      projectId?: string | null;
      projectName?: string | null;
      projectType?: number | string | null;
    }> | null;
  }> | null;
}

export class BigModelCodingPlanSubscriptionProvider {
  protected readonly apiClient: ApiClient;
  protected readonly credentialService: Pick<ICredentialService, "load">;
  private readonly resolveOffPeakModelSelectionView?: () => Promise<ModelSelectionView>;
  private clientConfigSnapshot: ZCodeClientConfigEnvelope | null = null;
  private clientConfigSnapshotExpiresAt = 0;
  private clientConfigRequest: Promise<ZCodeClientConfigEnvelope> | null = null;

  constructor(options: BigModelCodingPlanSubscriptionProviderOptions) {
    this.apiClient = options.apiClient;
    this.credentialService = options.credentialService;
    this.resolveOffPeakModelSelectionView = options.resolveOffPeakModelSelectionView;
  }

  // ─────────── family 维度抽象（供 ZaiCodingPlanSubscriptionProvider 覆盖）───────────
  // 原 enterprise 读方法（getEnterprisePricing / enrichEnterprisePricingTeamProjects 等）
  // 把 family 硬编码成 bigmodel：providerId=bigmodelCodingPlan、host=resolveBigModelApiOrigin、
  // token=loadBigModelAccessToken。zai family 对称化时无法复用。
  // 这里把 family 维度抽成 protected 虚方法，bigmodel 默认实现保持原行为，zai 子类覆盖即可。

  /** 当前 family 的 Coding Plan providerId（bigmodelCodingPlan / zaiCodingPlan）。 */
  protected codingPlanProviderId(): CodingPlanSubscriptionProviderId {
    return BUILTIN_MODEL_PROVIDER_IDS.bigmodelIndividualCodingPlan;
  }

  /** 当前 family 的业务域名（bigmodel 域 / zai 域）。 */
  protected resolveFamilyEnterpriseHost(): string {
    return resolveBigModelApiOrigin(process.env);
  }

  /** 当前 family 的业务 OAuth token。 */
  protected async loadFamilyEnterpriseToken(): Promise<string> {
    return this.loadBigModelAccessToken();
  }

  /** 当前 family 的业务鉴权头。 */
  protected createFamilyEnterpriseAuthHeaders(token: string): Record<string, string> {
    return createBigModelLoginAuthHeaders(token);
  }

  /**
   * 闲时任务灰度配置：复用 client/configs 通道零新增请求。
   * forceRefresh 供"打开 Automations 入口补拉"（1h 快照否则灰度翻转最长 1h 不可见）。
   */
  async getOffPeakClientConfig(options?: { forceRefresh?: boolean }): Promise<OffPeakClientConfig> {
    if (process.env["ZCODE_OFFPEAK_MOCK"] === "1") {
      // mock 已经明确替代远端曝光配置，不能再先等待 /client/configs：
      // 离线 Desktop E2E 会一直停在 Loading，根本无法进入闲时执行链。
      const modelSelectionView = await this.resolveOffPeakModelSelectionView?.();
      return resolveOffPeakClientConfig({}, process.env, modelSelectionView);
    }
    if (options?.forceRefresh) {
      this.clientConfigSnapshot = null;
      this.clientConfigSnapshotExpiresAt = 0;
    }
    const payload = await this.getClientConfigs();
    const modelSelectionView = await this.resolveOffPeakModelSelectionView?.();
    return resolveOffPeakClientConfig(payload, process.env, modelSelectionView);
  }

  /**
   * 动态工作流灰度快照：与闲时任务同走
   * client/configs，零新增请求。三条边界：
   *   1. 本地覆盖（ZCODE_DYNAMIC_WORKFLOW_MODE）在任何网络动作之前裁决，命中即返回——
   *      preview 构建和开发者手测因此不受 1h 快照与首次 Host 竞态影响；
   *   2. forceRefresh 与 Off-Peak 同义，清掉快照后重拉（灰度翻转最长 1h 不可见）；
   *   3. 请求失败 fail-closed：返回 default（disabled）并 warn，绝不把异常抛给调用方——
   *      调用方在 session create/client 就绪路径上，灰度读失败不能阻断普通聊天。
   */
  async getDynamicWorkflowClientConfig(options?: {
    forceRefresh?: boolean;
  }): Promise<DynamicWorkflowClientConfig> {
    // 覆盖合法即短路：判据（normalize）与快照构造（resolve）都留在 shared，这里不复述取值域。
    if (normalizeDynamicWorkflowMode(process.env[ZCODE_DYNAMIC_WORKFLOW_MODE_ENV])) {
      return resolveDynamicWorkflowClientConfig({ remote: undefined, env: process.env });
    }
    if (options?.forceRefresh) {
      this.clientConfigSnapshot = null;
      this.clientConfigSnapshotExpiresAt = 0;
    }
    try {
      const payload = await this.getClientConfigs();
      return resolveDynamicWorkflowClientConfig({
        remote: payload.data?.configs?.dynamicWorkflow,
        env: process.env,
      });
    } catch (error) {
      log.warn(undefined, "动态工作流灰度配置读取失败，按关闭处理", {
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      return createDynamicWorkflowClientConfig(DEFAULT_DYNAMIC_WORKFLOW_MODE, "default");
    }
  }

  async getModelContextBudgetStrategy(): Promise<ZCodeModelContextBudgetStrategy> {
    // 3.12.2：预算统一为 preflight-v1；保留兼容方法，但不能再为每次建会话等待远端配置。
    return DEFAULT_ZCODE_MODEL_CONTEXT_BUDGET_STRATEGY;
  }

  async getForceUpdateConfig(): Promise<ForceUpdateConfig | null> {
    const payload = await this.getClientConfigs();
    return unwrapClientConfigForceUpdate(payload);
  }

  async getEnterprisePricing(): Promise<EnterpriseCodingPlanPricingResponse> {
    const host = this.resolveFamilyEnterpriseHost();
    // 同一次权益读取必须固定账号。账号在 pricing 与项目预热之间切换时，
    // 重新读凭据会把旧账号套餐与新账号项目或项目 Key 混用。
    const token = await this.loadFamilyEnterpriseToken();
    const response = await this.get<EnterpriseCodingPlanPricingResponse>(
      new URL(`${host}${BIGMODEL_CODING_PLAN_API_PREFIX}/subscription/enterprise/v2/pricing`),
      token,
    );
    return this.enrichEnterprisePricingTeamProjects(response, token);
  }

  private async get<T>(url: URL, token: string): Promise<T> {
    const providerId = this.codingPlanProviderId();
    const payload = await readCodingPlanApiJson<RemoteEnvelope<T>>(this.apiClient, url, {
      method: "GET",
      timeoutMs: REQUEST_TIMEOUT_MS,
      headers: this.createFamilyEnterpriseAuthHeaders(token),
    });
    return unwrapEnvelope(payload, providerId);
  }

  private async getClientConfigs(): Promise<ZCodeClientConfigEnvelope> {
    if (this.clientConfigSnapshot && this.clientConfigSnapshotExpiresAt > Date.now()) {
      return this.clientConfigSnapshot;
    }
    if (this.clientConfigRequest) {
      return await this.clientConfigRequest;
    }

    // client/configs 和其他 ZCode 平台接口必须共享运行时 endpoint；
    // E2E/测试环境会通过 ZCODE_BASE_URL 指向本地 mock，硬编码线上域名会让套餐状态不可控。
    const url = resolveCodingPlanClientConfigUrl(process.env);
    url.searchParams.set("app_version", ZCODE_VERSION);
    url.searchParams.set("platform", resolveClientPlatformKey());
    // 闲时任务、动态工作流与更新配置共用该请求及 1h 快照。
    this.clientConfigRequest = readCodingPlanApiJson<ZCodeClientConfigEnvelope>(
      this.apiClient,
      url,
      {
        method: "GET",
        timeoutMs: REQUEST_TIMEOUT_MS,
      },
    );
    try {
      const payload = await this.clientConfigRequest;
      this.clientConfigSnapshot = payload;
      this.clientConfigSnapshotExpiresAt = Date.now() + CLIENT_CONFIG_CACHE_TTL_MS;
      return payload;
    } finally {
      this.clientConfigRequest = null;
    }
  }

  private async loadBigModelAccessToken(): Promise<string> {
    const token = (
      await this.credentialService.load(`oauth:${BIGMODEL_PROVIDER_ID}:access_token`)
    )?.trim();
    if (!token) {
      throw new Error("bigmodel_oauth_required");
    }
    const zcodeJwtToken = (await this.credentialService.load(ZCODE_JWT_TOKEN_KEY))?.trim();
    if (zcodeJwtToken && token === zcodeJwtToken) {
      // 旧版 BigModel OAuth callback 曾把 zcode JWT 同时写进
      // oauth:bigmodel:access_token，团队权益查询会拿它去打 bigmodel.cn 并报令牌过期。
      // 这里在服务边界拦截旧污染状态，避免继续向 BigModel 业务接口发送错误凭据。
      log.warn(undefined, "BigModel access token is stale zcode JWT; login required");
      throw new Error("bigmodel_oauth_required");
    }
    return token;
  }

  protected async enrichEnterprisePricingTeamProjects(
    response: EnterpriseCodingPlanPricingResponse,
    token: string,
  ): Promise<EnterpriseCodingPlanPricingResponse> {
    if (response.productList.length === 0) {
      return response;
    }
    const hasSubscribedProduct = response.productList.some(
      (product) => product.subscribed === true,
    );
    const hasSubscribedProductMissingProjectContext = response.productList.some(
      (product) =>
        product.subscribed === true &&
        (!product.projectId?.trim() || !product.organizationId?.trim()),
    );
    if (hasSubscribedProduct && !hasSubscribedProductMissingProjectContext) {
      const apiKeyStatuses = await this.ensureSubscribedTeamPlanProjectApiKeys(response, token);
      return applyTeamPlanProjectApiKeyStatuses(response, apiKeyStatuses);
    }

    const host = this.resolveFamilyEnterpriseHost();
    const customerInfo = await readCodingPlanApiJson<RemoteEnvelope<BigModelCustomerInfoResponse>>(
      this.apiClient,
      `${host}${BIGMODEL_CODING_PLAN_API_PREFIX}/customer/getCustomerInfo`,
      {
        method: "GET",
        timeoutMs: REQUEST_TIMEOUT_MS,
        headers: this.createFamilyEnterpriseAuthHeaders(token),
      },
    );
    const teamProjects = resolveBigModelTeamProjects(customerInfo.data);
    if (teamProjects.length === 0) {
      return response;
    }
    const fallbackSubscribedProductId = hasSubscribedProduct
      ? null
      : (resolveFallbackEnterpriseTeamPlanProduct(response.productList)?.productId ?? null);

    const enrichedResponse = {
      ...response,
      productList: response.productList.map((product) => {
        const shouldEnrichProduct =
          product.subscribed === true ||
          (fallbackSubscribedProductId !== null &&
            product.productId === fallbackSubscribedProductId);
        if (!shouldEnrichProduct) {
          return product;
        }
        const matchedTeamProjects = resolveProductTeamProjects(product, teamProjects);
        if (matchedTeamProjects.length === 0) {
          return product;
        }
        const primaryProject = matchedTeamProjects[0];
        return {
          ...product,
          // 企业 pricing 的 subscribed 商品只返回 productId/tier，不返回 org/project。
          // 有些账号只返回 organizationId，不返回 projectId；必须继续读取 customerInfo.organizations 数组，
          // 并按机构匹配团队项目，否则多机构账号会漏掉真实 Team Plan 连接方式。
          // 另有测试环境账号 pricing 全部返回 subscribed=false，但 customerInfo 已有 projectType=2 团队项目；
          // 此时 customerInfo 是更可靠的已购凭据，需要反向补出当前团队套餐入口。
          organizationId: primaryProject?.organizationId ?? product.organizationId,
          organizationName: primaryProject?.organizationName ?? product.organizationName,
          projectId: primaryProject?.projectId ?? product.projectId,
          projectName: primaryProject?.projectName ?? product.projectName,
          teamProjects: matchedTeamProjects,
          subscribed: true,
        };
      }),
    };
    const apiKeyStatuses = await this.ensureSubscribedTeamPlanProjectApiKeys(
      enrichedResponse,
      token,
    );
    return applyTeamPlanProjectApiKeyStatuses(enrichedResponse, apiKeyStatuses);
  }

  protected async ensureSubscribedTeamPlanProjectApiKeys(
    response: EnterpriseCodingPlanPricingResponse,
    token: string,
  ): Promise<Map<string, TeamPlanProjectApiKeyPrewarmStatus>> {
    const teamContexts = collectSubscribedTeamPlanProjectContexts(response.productList);
    const statuses = new Map<string, TeamPlanProjectApiKeyPrewarmStatus>();
    if (teamContexts.length === 0) {
      return statuses;
    }
    const host = this.resolveFamilyEnterpriseHost();
    log.info(undefined, "Team Plan project api key prewarm started", {
      family: this.codingPlanProviderId(),
      teamProjectCount: teamContexts.length,
    });
    for (const teamContext of teamContexts) {
      try {
        const result = await ensureBigModelTeamPlanProjectApiKeyWithStatus({
          apiClient: this.apiClient,
          authorization: token,
          host,
          teamContext,
          timeoutMs: REQUEST_TIMEOUT_MS,
        });
        log.info(undefined, "Team Plan project api key prewarm result", {
          family: this.codingPlanProviderId(),
          diagnostics: result.diagnostics,
          organizationId: teamContext.organizationId,
          projectId: teamContext.projectId,
          status: result.status,
        });
        statuses.set(
          createTeamPlanProjectStatusKey(teamContext),
          createTeamPlanProjectApiKeyPrewarmStatusFromEnsureResult(result),
        );
      } catch (error) {
        // 多团队套餐每个项目都需要独立 zcode-team-api-key。
        // 单个团队项目创建失败不能阻断 pricing 返回，否则会让其他团队入口一起不可见。
        log.warn(undefined, "Team Plan project api key prewarm failed", {
          family: this.codingPlanProviderId(),
          organizationId: teamContext.organizationId,
          projectId: teamContext.projectId,
          error: error instanceof Error ? error.message : String(error),
        });
        statuses.set(createTeamPlanProjectStatusKey(teamContext), {
          status: "unavailable",
          reason: "request_failed",
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return statuses;
  }

  protected async loadZaiAuthorization(): Promise<string> {
    const token = (
      await this.credentialService.load(`oauth:${ZAI_PROVIDER_ID}:access_token`)
    )?.trim();
    if (!token) {
      throw new Error("zai_oauth_required");
    }

    return token;
  }
}

function resolveCodingPlanClientConfigUrl(env: NodeJS.ProcessEnv): URL {
  return new URL(buildRuntimeZCodeApiUrl(env, ZCODE_CLIENT_CONFIG_API_PREFIX));
}

function resolveFallbackEnterpriseTeamPlanProduct(
  products: EnterpriseCodingPlanPricingProduct[],
): EnterpriseCodingPlanPricingProduct | null {
  let selected: EnterpriseCodingPlanPricingProduct | null = null;
  let selectedScore = Number.NEGATIVE_INFINITY;
  for (const product of products) {
    const score = getEnterpriseTeamPlanFallbackProductScore(product);
    if (score > selectedScore) {
      selected = product;
      selectedScore = score;
    }
  }
  return selected;
}

function applyTeamPlanProjectApiKeyStatuses(
  response: EnterpriseCodingPlanPricingResponse,
  statuses: Map<string, TeamPlanProjectApiKeyPrewarmStatus>,
): EnterpriseCodingPlanPricingResponse {
  if (statuses.size === 0) {
    return response;
  }
  return {
    ...response,
    productList: response.productList.map((product) =>
      applyTeamPlanProjectApiKeyStatus(product, statuses),
    ),
  };
}

function applyTeamPlanProjectApiKeyStatus(
  product: EnterpriseCodingPlanPricingProduct,
  statuses: Map<string, TeamPlanProjectApiKeyPrewarmStatus>,
): EnterpriseCodingPlanPricingProduct {
  const teamProjects = product.teamProjects?.map((project) =>
    applyTeamPlanProjectContextApiKeyStatus(project, statuses),
  );
  const productStatus = getTeamPlanProjectApiKeyStatus(
    {
      organizationId: product.organizationId ?? "",
      projectId: product.projectId ?? "",
    },
    statuses,
  );
  return {
    ...product,
    ...(teamProjects ? { teamProjects } : {}),
    ...(productStatus ? createTeamPlanProjectApiKeyStatusFields(productStatus) : {}),
  };
}

function applyTeamPlanProjectContextApiKeyStatus(
  project: EnterpriseCodingPlanProjectContext,
  statuses: Map<string, TeamPlanProjectApiKeyPrewarmStatus>,
): EnterpriseCodingPlanProjectContext {
  const status = getTeamPlanProjectApiKeyStatus(project, statuses);
  if (!status) {
    return project;
  }
  return {
    ...project,
    ...createTeamPlanProjectApiKeyStatusFields(status),
  };
}

function createTeamPlanProjectApiKeyStatusFields(
  status: TeamPlanProjectApiKeyPrewarmStatus,
): Pick<
  EnterpriseCodingPlanProjectContext,
  "apiKeyStatus" | "apiKeyUnavailableReason" | "apiKeyUnavailableMessage"
> {
  return {
    apiKeyStatus: status.status,
    apiKeyUnavailableReason: status.status === "unavailable" ? (status.reason ?? null) : null,
    apiKeyUnavailableMessage: status.status === "unavailable" ? (status.message ?? null) : null,
  };
}

function getTeamPlanProjectApiKeyStatus(
  project: Pick<EnterpriseCodingPlanProjectContext, "organizationId" | "projectId">,
  statuses: Map<string, TeamPlanProjectApiKeyPrewarmStatus>,
): TeamPlanProjectApiKeyPrewarmStatus | null {
  const organizationId = project.organizationId?.trim() ?? "";
  const projectId = project.projectId?.trim() ?? "";
  if (!organizationId || !projectId) {
    return null;
  }
  return statuses.get(createTeamPlanProjectStatusKey({ organizationId, projectId })) ?? null;
}

function createTeamPlanProjectApiKeyPrewarmStatusFromEnsureResult(
  result: BigModelTeamPlanApiKeyEnsureResult,
): TeamPlanProjectApiKeyPrewarmStatus {
  if (result.apiKey) {
    return { status: "available" };
  }
  return {
    status: "unavailable",
    reason: isNoValidTeamPlanAuthorizationMessage(result.diagnostics.create?.msg)
      ? "no_valid_team_plan_authorization"
      : "request_failed",
    message: result.diagnostics.create?.msg ?? result.diagnostics.list.msg ?? null,
  };
}

function createTeamPlanProjectStatusKey(
  project: Pick<EnterpriseCodingPlanProjectContext, "organizationId" | "projectId">,
): string {
  return `${project.organizationId.trim()}:${project.projectId.trim()}`;
}

function isNoValidTeamPlanAuthorizationMessage(message: string | null | undefined): boolean {
  return Boolean(message?.includes("暂无有效的团队套餐授权记录"));
}

function getEnterpriseTeamPlanFallbackProductScore(
  product: EnterpriseCodingPlanPricingProduct,
): number {
  let score = 0;
  if (product.tier === "PRO") {
    score += 100;
  }
  if (product.subscribeMode === "ONE_TIME") {
    score += 20;
  }
  if (product.subscribePeriod === "MONTHLY") {
    score += 10;
  }
  return score;
}

function resolveProductTeamProjects(
  product: EnterpriseCodingPlanPricingProduct,
  teamProjects: EnterpriseCodingPlanProjectContext[],
): EnterpriseCodingPlanProjectContext[] {
  const organizationId = product.organizationId?.trim() ?? "";
  const projectId = product.projectId?.trim() ?? "";
  return teamProjects.filter((project) => {
    if (organizationId && project.organizationId !== organizationId) {
      return false;
    }
    if (projectId && project.projectId !== projectId) {
      return false;
    }
    return true;
  });
}

function collectSubscribedTeamPlanProjectContexts(
  products: readonly EnterpriseCodingPlanPricingProduct[],
): BigModelTeamPlanBizContext[] {
  const result: BigModelTeamPlanBizContext[] = [];
  const seen = new Set<string>();
  for (const product of products) {
    if (product.subscribed !== true) {
      continue;
    }
    const projectContexts =
      product.teamProjects && product.teamProjects.length > 0
        ? product.teamProjects
        : [
            {
              organizationId: product.organizationId ?? null,
              projectId: product.projectId ?? null,
            },
          ];
    for (const projectContext of projectContexts) {
      const organizationId = projectContext.organizationId?.trim() ?? "";
      const projectId = projectContext.projectId?.trim() ?? "";
      if (!organizationId || !projectId) {
        continue;
      }
      const key = `${organizationId}\0${projectId}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      result.push({ organizationId, projectId });
    }
  }
  return result;
}

function resolveBigModelTeamProjects(
  customerInfo: BigModelCustomerInfoResponse | null | undefined,
): EnterpriseCodingPlanProjectContext[] {
  const result: EnterpriseCodingPlanProjectContext[] = [];
  for (const organization of customerInfo?.organizations ?? []) {
    const organizationId = organization.organizationId?.trim() ?? "";
    if (!organizationId) {
      continue;
    }
    for (const project of organization.projects ?? []) {
      const projectId = project.projectId?.trim() ?? "";
      if (!projectId || !isBigModelTeamCodingPlanProject(project)) {
        continue;
      }
      result.push({
        organizationId,
        organizationName: organization.organizationName ?? null,
        projectId,
        projectName: project.projectName ?? null,
      });
    }
  }
  return result;
}

function isBigModelTeamCodingPlanProject(
  project: NonNullable<
    NonNullable<BigModelCustomerInfoResponse["organizations"]>[number]["projects"]
  >[number],
): boolean {
  // 团队套餐项目类型由 customerInfo.projectType 标识。
  // 不能写死项目名称，否则团队项目改名或国际化名称变化后会漏选。
  return String(project.projectType ?? "").trim() === "2";
}

export function createBigModelLoginAuthHeaders(token: string): Record<string, string> {
  return {
    // BigModel 登录态业务接口要求 Authorization 直接传 accessToken。
    // 这里不能套 Bearer；Bearer 只适用于模型/API Key 类接口。
    Authorization: token,
    "Content-Type": "application/json",
  };
}

export function createZaiLoginAuthHeaders(token: string): Record<string, string> {
  return {
    // Z.ai provider connection 已把 access_token 持久化为业务 JWT。
    // 这里不能使用模型 API key，也不能给业务 JWT 添加 Bearer 前缀。
    Authorization: token,
    "Content-Type": "application/json",
  };
}

function unwrapEnvelope<T>(
  payload: RemoteEnvelope<T>,
  providerId: CodingPlanSubscriptionProviderId,
): T {
  if (payload.code !== undefined && payload.code !== 200) {
    throw new Error(normalizeRemoteErrorMessage(payload.msg, providerId, payload.code));
  }
  if (payload.success === false) {
    throw new Error(normalizeRemoteErrorMessage(payload.msg, providerId));
  }
  if (payload.data === null || payload.data === undefined) {
    const providerName = resolveCodingPlanProviderName(providerId);
    throw new Error(payload.msg?.trim() || `${providerName} response missing data`);
  }
  return payload.data;
}

function unwrapClientConfigForceUpdate(
  payload: ZCodeClientConfigEnvelope,
): ForceUpdateConfig | null {
  if (payload.code !== undefined && payload.code !== 0) {
    throw new Error(payload.msg?.trim() || "ZCode client config request failed");
  }

  const forceUpdate = payload.data?.configs?.forceUpdate;
  if (!forceUpdate) {
    return null;
  }

  const minimalVersion = forceUpdate.minimalVersion;
  if (typeof minimalVersion !== "string" || minimalVersion.trim() === "") {
    return null;
  }

  return { minimalVersion: minimalVersion.trim() };
}

function resolveClientPlatformKey(): string {
  return `${process.platform}-${process.arch}`;
}

function normalizeRemoteErrorMessage(
  msg: string | undefined,
  providerId: CodingPlanSubscriptionProviderId,
  code?: number,
) {
  const message = msg?.trim();
  if (message && isUnrenderableRemoteErrorMessage(message)) {
    return CODING_PLAN_SYSTEM_BUSY;
  }
  const providerName = resolveCodingPlanProviderName(providerId);
  return message || `${providerName} request failed${code ? `: ${code}` : ""}`;
}

async function readCodingPlanApiJson<T>(
  apiClient: ApiClient,
  input: string | URL,
  init?: ApiRequestInit,
): Promise<T> {
  try {
    return await readApiJson<T>(apiClient, input, init);
  } catch (error) {
    const message = readRemoteErrorMessage(error);
    if (isUnrenderableRemoteErrorMessage(message)) {
      // 供应商权益接口偶发返回 WAF/HTML 页面；服务边界将它收敛为稳定错误码，
      // 避免把页面内容当作错误文案渲染到设置页。
      throw new Error(CODING_PLAN_SYSTEM_BUSY);
    }
    throw error;
  }
}

function readRemoteErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message || error.name;
  }
  if (typeof error === "object" && error !== null && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") {
      return message;
    }
  }
  return String(error);
}

function isUnrenderableRemoteErrorMessage(message: string): boolean {
  const normalized = message.trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  return (
    normalized.startsWith("<!doctype") ||
    /<\s*(html|head|body|script|style|title|meta)\b/.test(normalized) ||
    normalized.includes("errors.aliyun.com") ||
    normalized.includes("request has been blocked") ||
    normalized.includes("unexpected token '<'") ||
    normalized.includes("unexpected end of json input") ||
    normalized.includes("invalid json response")
  );
}

function resolveCodingPlanProviderName(providerId: CodingPlanSubscriptionProviderId): string {
  return isZaiCodingPlanProviderId(providerId) ? "Z.ai" : "BigModel";
}

export function resolveOffPeakClientConfig(
  payload: ZCodeClientConfigEnvelope,
  env: NodeJS.ProcessEnv,
  modelSelectionView: ModelSelectionView = EMPTY_OFF_PEAK_MODEL_SELECTION_VIEW,
): OffPeakClientConfig {
  const hasModels = modelSelectionView.providers.some((provider) => provider.models.length > 0);
  if (env["ZCODE_OFFPEAK_MOCK"] === "1") {
    return {
      enabled: hasModels,
      modelSelectionView,
      // ZCODE_OFFPEAK_MOCK_NO_PLAN=1 演示「非 coding plan 锁定」态；缺省视为已订阅。
      codingPlanActive: env["ZCODE_OFFPEAK_MOCK_NO_PLAN"] !== "1",
    };
  }
  const raw = payload.data?.configs?.offPeak;
  return {
    enabled: raw?.enable_offpeak_task === true && hasModels,
    modelSelectionView,
  };
}

const EMPTY_OFF_PEAK_MODEL_SELECTION_VIEW: ModelSelectionView = Object.freeze({
  revision: 0,
  providers: Object.freeze([]),
});
