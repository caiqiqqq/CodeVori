import { createHash } from "node:crypto";
import {
  BIGMODEL_PROVIDER_ID,
  type OAuthProviderId,
  type ProviderFamilyDomain,
  type ZCodeAccountAccess,
  type ZCodeProviderAccountAccess,
  ZAI_PROVIDER_ID,
} from "@zcode/shared";

export interface AccountRequestAuthMaterial {
  apiKey?: string;
  headers?: Record<string, string>;
}

export interface AccountRequestAuthInput {
  providerId: string;
  modelId?: string;
  accountAccess: ZCodeProviderAccountAccess | ZCodeAccountAccess;
  reason: "model-request" | "off-peak" | "usage";
}

export interface AccountAccessIdentityInput {
  providerId: string;
  accountAccess: ZCodeProviderAccountAccess | ZCodeAccountAccess;
}

export class AccountRequestCredentialUnavailableError extends Error {
  constructor(readonly providerId: string) {
    super(`Account request credential is unavailable: ${providerId}`);
    this.name = "AccountRequestCredentialUnavailableError";
  }
}

export interface AccountRequestAuthResolver {
  resolveAccessCurrent(access: ZCodeProviderAccountAccess): Promise<ZCodeAccountAccess | null>;
  resolveCurrent(input: AccountRequestAuthInput): Promise<AccountRequestAuthMaterial>;
  assertCurrent(input: AccountAccessIdentityInput): Promise<void>;
}

interface AccountProviderRequestAuthServiceOptions {
  resolveCurrentAccountAccess(
    access: ZCodeProviderAccountAccess,
  ): Promise<ZCodeAccountAccess | null>;
  loadOAuthTokenSet(providerId: OAuthProviderId): Promise<{
    accessToken?: string | null;
    zcodeJwtToken?: string | null;
  } | null>;
  loadIndividualPlanApiKey(
    providerId: string,
    family: ProviderFamilyDomain,
  ): Promise<string | null>;
  resolveTeamPlanApiKey(
    access: Extract<ZCodeAccountAccess, { planKind: "team-coding-plan" }>,
  ): Promise<string | null>;
}

class AccountProviderRequestAuthService implements AccountRequestAuthResolver {
  readonly #options: AccountProviderRequestAuthServiceOptions;

  constructor(options: AccountProviderRequestAuthServiceOptions) {
    this.#options = options;
  }

  resolveAccessCurrent(access: ZCodeProviderAccountAccess): Promise<ZCodeAccountAccess | null> {
    return this.#options.resolveCurrentAccountAccess(access);
  }

  async resolveCurrent(input: AccountRequestAuthInput): Promise<AccountRequestAuthMaterial> {
    const providerId = input.providerId.trim();
    const access = await this.#resolveAccess(input.accountAccess);
    if (!access) throw new AccountRequestCredentialUnavailableError(providerId);
    const login = await this.#options.loadOAuthTokenSet(resolveOAuthProviderId(access.family));
    const scope = requestScope(access, login, providerId);
    const apiKey =
      access.planKind === "start-plan"
        ? login?.zcodeJwtToken
        : access.planKind === "individual-coding-plan"
          ? await this.#options.loadIndividualPlanApiKey(providerId, access.family)
          : await this.#options.resolveTeamPlanApiKey(access);

    // 多个 Agent 的 key IO 可以交错完成；只检查 IO 前的连接会返回已退出账号或旧项目的材料。
    // scope 属于本次调用，不写共享 Registry；迟到结果失效不影响其他并发/后续请求。
    const latest = await this.#resolveAccess(input.accountAccess);
    if (
      !latest ||
      scope !==
        requestScope(
          latest,
          await this.#options.loadOAuthTokenSet(resolveOAuthProviderId(latest.family)),
          providerId,
        )
    ) {
      throw new AccountRequestCredentialUnavailableError(providerId);
    }
    return { apiKey: requireApiKey(apiKey, providerId) };
  }

  async assertCurrent(input: AccountAccessIdentityInput): Promise<void> {
    if (!(await this.#resolveAccess(input.accountAccess))) {
      throw new AccountRequestCredentialUnavailableError(input.providerId);
    }
  }

  async #resolveAccess(
    access: ZCodeProviderAccountAccess | ZCodeAccountAccess,
  ): Promise<ZCodeAccountAccess | null> {
    if ("mode" in access) return this.#options.resolveCurrentAccountAccess(access);
    // 已解析 access 只是调用方快照，也必须向同一连接事实入口复核，不能绕过换号/换项目失效。
    const current = await this.#options.resolveCurrentAccountAccess({
      type: "zhipu-account",
      accountType: access.family,
      mode: access.planKind,
      entitled: true,
    });
    return current && accessScope(current) === accessScope(access) ? current : null;
  }
}

function accessScope(access: ZCodeAccountAccess): string {
  return JSON.stringify([
    access.family,
    access.planKind,
    access.planKind === "team-coding-plan"
      ? [access.organizationId, access.projectId, access.productId]
      : null,
  ]);
}

function requestScope(
  access: ZCodeAccountAccess,
  login: { accessToken?: string | null; zcodeJwtToken?: string | null } | null,
  providerId: string,
): string {
  requireApiKey(
    access.planKind === "start-plan" ? login?.zcodeJwtToken : login?.accessToken,
    providerId,
  );
  return createHash("sha256")
    .update(
      JSON.stringify([
        accessScope(access),
        login?.accessToken?.trim(),
        login?.zcodeJwtToken?.trim(),
      ]),
    )
    .digest("hex");
}

function resolveOAuthProviderId(family: ProviderFamilyDomain): OAuthProviderId {
  return family === "zai" ? ZAI_PROVIDER_ID : BIGMODEL_PROVIDER_ID;
}

function requireApiKey(value: string | null | undefined, providerId: string): string {
  const normalized = value?.trim() ?? "";
  if (!normalized) {
    throw new AccountRequestCredentialUnavailableError(providerId);
  }
  return normalized;
}

export function createAccountProviderRequestAuthService(
  options: AccountProviderRequestAuthServiceOptions,
): AccountProviderRequestAuthService {
  return new AccountProviderRequestAuthService(options);
}
