import { randomUUID } from "node:crypto";
import { isAbsolute } from "node:path";
import { homedir } from "node:os";
import {
  gitAccountAddRequestSchema,
  gitAccountIdRequestSchema,
  gitAccountRotateRequestSchema,
  gitPathRequestSchema,
  gitVersionControlSettingsSchema,
  type GitDetection,
} from "@zcode/shared";
import type { IGitService } from "./git.js";
import { createGitEnvironmentProvider } from "./providers/gitEnvironmentProvider.js";
import { createGitCommandProvider } from "./providers/gitCommandProvider.js";
import {
  normalizeGitServerUrl,
  validateForgeCredential,
} from "./providers/forgeCredentialProvider.js";
import { createVersionControlRepo, type VersionControlRepo } from "./repo/versionControlRepo.js";

export type VersionControlService = Pick<
  IGitService,
  | "getVersionControlSettings"
  | "detectGit"
  | "updateGitPath"
  | "addGitAccount"
  | "rotateGitAccount"
  | "testGitAccount"
  | "setDefaultGitAccount"
  | "removeGitAccount"
>;

export function createVersionControlService(options?: {
  repo?: VersionControlRepo;
  fetcher?: typeof fetch;
}): VersionControlService {
  const repo = options?.repo ?? createVersionControlRepo();
  const detect = async (path: string | null): Promise<GitDetection> => {
    const environmentProvider = createGitEnvironmentProvider();
    const binary = path ?? (await environmentProvider.resolveGitBinary());
    if (!binary) return { installed: false, path: null, version: null };
    const commands = createGitCommandProvider({
      environmentProvider,
      getConfiguredGitPath: async () => binary,
    });
    const result = await commands.run({ cwd: homedir(), args: ["--version"], timeoutMs: 5_000 });
    const version = result.stdout.trim();
    const installed = result.exitCode === 0 && /^git version \d+\./.test(version);
    return { installed, path: binary, version: installed ? version : null };
  };
  const find = async (accountId: string) => {
    const account = (await repo.read()).accounts.find((entry) => entry.id === accountId);
    if (!account) throw new Error("VERSION_CONTROL_ACCOUNT_NOT_FOUND");
    return account;
  };
  return {
    async getVersionControlSettings() {
      return gitVersionControlSettingsSchema.parse(await repo.read());
    },
    async detectGit() {
      return detect((await repo.read()).customPath);
    },
    async updateGitPath(input) {
      const { path } = gitPathRequestSchema.parse(input);
      if (path && (!isAbsolute(path) || /[\r\n]/.test(path) || path.includes("\0")))
        throw new Error("VERSION_CONTROL_INVALID_GIT_PATH");
      const result = await detect(path || null);
      if (path && !result.installed) throw new Error("VERSION_CONTROL_INVALID_GIT_PATH");
      await repo.update((current) => ({ ...current, customPath: path || null }));
      return result;
    },
    async addGitAccount(input) {
      const request = gitAccountAddRequestSchema.parse(input);
      const serverUrl = normalizeGitServerUrl(request.serverUrl);
      const user =
        request.provider === "git"
          ? {
              success: Boolean(request.username),
              username: request.username,
              scopes: [],
              avatarUrl: null,
            }
          : await validateForgeCredential(
              request.provider,
              serverUrl,
              request.secret,
              options?.fetcher,
            );
      if (
        !user.success ||
        !user.username ||
        /[\r\n]/.test(user.username) ||
        user.username.includes("\0")
      ) {
        throw new Error(`VERSION_CONTROL_${"error" in user ? user.error : "INVALID_ACCOUNT"}`);
      }
      const account = {
        id: randomUUID(),
        provider: request.provider,
        serverUrl,
        username: user.username,
        scopes: user.scopes,
        avatarUrl: user.avatarUrl ?? null,
        createdAt: new Date().toISOString(),
        secret: request.secret,
      };
      return gitVersionControlSettingsSchema.parse(
        await repo.update((current) => ({
          ...current,
          accounts: [...current.accounts, { ...account, isDefault: current.accounts.length === 0 }],
        })),
      );
    },
    async rotateGitAccount(input) {
      const { accountId, secret } = gitAccountRotateRequestSchema.parse(input);
      const original = await find(accountId);
      const user =
        original.provider === "git"
          ? null
          : await validateForgeCredential(
              original.provider,
              original.serverUrl,
              secret,
              options?.fetcher,
            );
      if (user && (!user.success || user.username !== original.username))
        throw new Error(`VERSION_CONTROL_${user.error ?? "identity-changed"}`);
      return gitVersionControlSettingsSchema.parse(
        await repo.update((current) => {
          // 网络验证期间账号可能已被移除/更新；不允许迟到的验证结果复活账号或覆盖新令牌。
          const latest = current.accounts.find((entry) => entry.id === accountId);
          if (!latest || latest.secret !== original.secret)
            throw new Error("VERSION_CONTROL_ACCOUNT_CHANGED");
          return {
            ...current,
            accounts: current.accounts.map((entry) =>
              entry.id === accountId
                ? {
                    ...entry,
                    secret,
                    scopes: user?.scopes ?? entry.scopes,
                    avatarUrl: user?.avatarUrl ?? entry.avatarUrl,
                  }
                : entry,
            ),
          };
        }),
      );
    },
    async testGitAccount(input) {
      const { accountId } = gitAccountIdRequestSchema.parse(input);
      const account = await find(accountId);
      if (account.provider === "git") return { success: Boolean(account.secret), kind: "stored" };
      const { success, error, statusCode, username } = await validateForgeCredential(
        account.provider,
        account.serverUrl,
        account.secret,
        options?.fetcher,
      );
      return success && username !== account.username
        ? { success: false, kind: "forge", error: "identity-changed" }
        : {
            success,
            kind: "forge",
            ...(error ? { error } : {}),
            ...(statusCode ? { statusCode } : {}),
          };
    },
    async setDefaultGitAccount(input) {
      const { accountId } = gitAccountIdRequestSchema.parse(input);
      return gitVersionControlSettingsSchema.parse(
        await repo.update((current) => {
          if (!current.accounts.some((entry) => entry.id === accountId))
            throw new Error("VERSION_CONTROL_ACCOUNT_NOT_FOUND");
          return {
            ...current,
            accounts: current.accounts.map((entry) => ({
              ...entry,
              isDefault: entry.id === accountId,
            })),
          };
        }),
      );
    },
    async removeGitAccount(input) {
      const { accountId } = gitAccountIdRequestSchema.parse(input);
      return gitVersionControlSettingsSchema.parse(
        await repo.update((current) => {
          const accounts = current.accounts.filter((entry) => entry.id !== accountId);
          const first = accounts[0];
          if (first && !accounts.some((entry) => entry.isDefault))
            accounts[0] = { ...first, isDefault: true };
          return { ...current, accounts };
        }),
      );
    },
  };
}
