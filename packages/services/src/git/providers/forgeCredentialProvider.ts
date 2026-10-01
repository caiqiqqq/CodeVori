import type { GitAccountProvider, GitAccountTestResult } from "@zcode/shared";
import { z } from "zod";

const userSchema = z.object({
  login: z.string().min(1).max(256).optional(),
  username: z.string().min(1).max(256).optional(),
  avatar_url: z.string().nullable().optional(),
});

export interface ForgeCredentialValidation extends GitAccountTestResult {
  username?: string;
  scopes: string[];
  avatarUrl?: string | null;
}

export function normalizeGitServerUrl(raw: string): string {
  const value = raw.trim();
  let url: URL;
  try {
    url = new URL(value.includes("://") ? value : `https://${value}`);
  } catch {
    throw new Error("VERSION_CONTROL_INVALID_SERVER_URL");
  }
  if (
    !["https:", "http:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error("VERSION_CONTROL_INVALID_SERVER_URL");
  }
  return url.toString().replace(/\/+$/, "");
}

export async function validateForgeCredential(
  provider: Exclude<GitAccountProvider, "git">,
  serverUrl: string,
  secret: string,
  fetcher: typeof fetch = fetch,
): Promise<ForgeCredentialValidation> {
  const server = normalizeGitServerUrl(serverUrl);
  const publicGitHub = server === "https://github.com";
  const base =
    provider === "github"
      ? publicGitHub
        ? "https://api.github.com"
        : `${server}/api/v3`
      : `${server}/api/${provider === "gitlab" ? "v4" : "v1"}`;
  const headers = {
    "User-Agent": "ZCode",
    Accept: "application/json",
    ...(provider === "gitlab"
      ? { "PRIVATE-TOKEN": secret }
      : { Authorization: `${provider === "gitea" ? "token" : "Bearer"} ${secret}` }),
  };
  const signal = AbortSignal.timeout(8_000);
  const failure = (
    error: GitAccountTestResult["error"],
    statusCode?: number,
  ): ForgeCredentialValidation => ({
    success: false,
    kind: "forge",
    error,
    ...(statusCode ? { statusCode } : {}),
    scopes: [],
  });
  try {
    // 自动跳转会把用户令牌交给非预期服务器；只接受配置的 API 直接返回的身份。
    const response = await fetcher(`${base}/user`, { headers, redirect: "error", signal });
    if (!response.ok) {
      await response.body?.cancel();
      return failure(
        response.status === 401
          ? "authentication"
          : response.status === 403
            ? "forbidden"
            : "response",
        response.status,
      );
    }
    const parsed = userSchema.safeParse(await response.json());
    if (!parsed.success) return failure("response");
    const username = provider === "gitlab" ? parsed.data.username : parsed.data.login;
    if (!username || /[\r\n]/.test(username) || username.includes("\0")) return failure("response");
    let scopes =
      provider === "github"
        ? (response.headers.get("x-oauth-scopes") ?? "")
            .split(",")
            .map((scope) => scope.trim())
            .filter(Boolean)
        : [];
    if (provider === "gitlab") {
      try {
        const scopeResponse = await fetcher(`${base}/personal_access_tokens/self`, {
          headers,
          redirect: "error",
          signal,
        });
        if (scopeResponse.ok) {
          const scopeData = z
            .object({ scopes: z.array(z.string()) })
            .safeParse(await scopeResponse.json());
          if (scopeData.success) scopes = scopeData.data.scopes;
        } else {
          await scopeResponse.body?.cancel();
        }
      } catch {
        // 旧版 GitLab/非 PAT 凭据不提供 scopes，用户 API 已验证的身份仍然有效。
      }
    }
    const avatar = parsed.data.avatar_url;
    const avatarUrl = avatar && /^https?:\/\//.test(avatar) ? avatar : null;
    return { success: true, kind: "forge", username, scopes, avatarUrl };
  } catch {
    // 不回传外部响应正文/异常详情，避免错误页回显令牌或认证头。
    return failure("network");
  }
}
