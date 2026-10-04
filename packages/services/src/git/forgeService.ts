import {
  forgeCommentRequestSchema,
  forgeItemRequestSchema,
  forgeListRequestSchema,
  forgeMergeRequestSchema,
  forgeNewIssueRequestSchema,
  forgePageRequestSchema,
  forgeRepositoryRequestSchema,
  forgeStateRequestSchema,
  forgeTargetRequestSchema,
  type ForgeRepositoryInfo,
  type ForgeRepositoryRequest,
  type ForgeTargetRequest,
} from "@zcode/shared";
import type { IGitService } from "./git.js";
import { createGitCliRepo } from "./repo/gitCliRepo.js";
import type { GitCliRepo } from "./repo/gitCliTypes.js";
import { createVersionControlRepo, type VersionControlRepo } from "./repo/versionControlRepo.js";
import {
  createGitCommandProvider,
  type GitCommandProvider,
} from "./providers/gitCommandProvider.js";
import { createForgeApiClient } from "./providers/forgeApiClient.js";
import {
  forgeRepository,
  knownForgeProvider,
  parseForgeRemote,
  selectForgeAccount,
} from "./providers/forgeRemote.js";
import { createGithubForgeProvider } from "./providers/githubForgeProvider.js";
import { createGitlabForgeProvider } from "./providers/gitlabForgeProvider.js";
import { createGiteaForgeProvider } from "./providers/giteaForgeProvider.js";

export type ForgeService = Pick<
  IGitService,
  | "getForgeRepository"
  | "listForgeItems"
  | "getForgeItem"
  | "listForgeComments"
  | "listForgeFiles"
  | "listForgeLabels"
  | "createForgeIssue"
  | "createForgeComment"
  | "setForgeItemState"
  | "mergeForgePullRequest"
>;

export function createForgeService(options?: {
  gitRepo?: Pick<GitCliRepo, "resolveRepository">;
  commandProvider?: GitCommandProvider;
  credentials?: VersionControlRepo;
  fetcher?: typeof fetch;
}): ForgeService {
  const gitRepo = options?.gitRepo ?? createGitCliRepo();
  const commands = options?.commandProvider ?? createGitCommandProvider();
  const credentials = options?.credentials ?? createVersionControlRepo();
  const resolve = async (request: ForgeRepositoryRequest) => {
    const empty: ForgeRepositoryInfo = {
      status: "no-remote",
      remoteNames: [],
      remoteName: null,
      host: null,
      provider: null,
      repository: null,
    };
    const resolution = await gitRepo.resolveRepository(request.workspacePath);
    if (!resolution.isGitAvailable)
      return { info: { ...empty, status: "git-unavailable" as const }, adapter: null };
    if (!resolution.isRepository)
      return { info: { ...empty, status: "not-repository" as const }, adapter: null };
    const names = await commands.run({ cwd: resolution.repoRoot, args: ["remote"] });
    if (names.exitCode !== 0) throw new Error("FORGE_RESPONSE");
    const remoteNames = names.stdout.trim().split(/\r?\n/).filter(Boolean);
    const remoteName =
      request.remoteName ?? (remoteNames.includes("origin") ? "origin" : (remoteNames[0] ?? null));
    const info = { ...empty, remoteNames, remoteName };
    if (!remoteName || !remoteNames.includes(remoteName)) return { info, adapter: null };
    const remoteResult = await commands.run({
      cwd: resolution.repoRoot,
      args: ["remote", "get-url", remoteName],
    });
    if (remoteResult.exitCode !== 0) throw new Error("FORGE_RESPONSE");
    const remote = parseForgeRemote(remoteResult.stdout.trim());
    if (!remote) return { info: { ...info, status: "unsupported" as const }, adapter: null };
    info.host = remote.ssh ? remote.hostname : remote.host;
    info.provider = knownForgeProvider(remote);
    const accounts = (await credentials.read()).accounts;
    const account = selectForgeAccount(remote, accounts, request.accountId);
    if (!account) {
      // 已保存账号不等于适用于当前服务器；自建平台也要区分账号缺失与匹配失败。
      const status: ForgeRepositoryInfo["status"] = accounts.length
        ? "account-mismatch"
        : info.provider
          ? "missing-account"
          : "unsupported";
      return {
        info: { ...info, status },
        adapter: null,
      };
    }
    const resolved = forgeRepository(remote, account);
    if (!resolved) return { info: { ...info, status: "unsupported" as const }, adapter: null };
    const api = createForgeApiClient({
      baseUrl: resolved.apiBase,
      provider: resolved.repository.provider,
      secret: account.secret,
      fetcher: options?.fetcher ?? fetch,
    });
    const adapter =
      resolved.repository.provider === "github"
        ? createGithubForgeProvider(api, resolved.repository.name)
        : resolved.repository.provider === "gitlab"
          ? createGitlabForgeProvider(api, resolved.repository.name)
          : createGiteaForgeProvider(api, resolved.repository.name);
    return {
      info: {
        ...info,
        status: "ready" as const,
        repository: resolved.repository,
        provider: resolved.repository.provider,
      },
      adapter,
    };
  };
  const target = async (request: ForgeTargetRequest) => {
    const { info, adapter } = await resolve(request);
    if (
      info.status === "missing-account" ||
      info.status === "account-mismatch" ||
      (info.status === "unsupported" && request.accountId)
    )
      throw new Error("FORGE_MISSING_ACCOUNT");
    if (!adapter || info.repository?.key !== request.repositoryKey)
      throw new Error("FORGE_TARGET_CHANGED");
    return adapter;
  };
  return {
    async getForgeRepository(input) {
      return (await resolve(forgeRepositoryRequestSchema.parse(input))).info;
    },
    async listForgeItems(input) {
      const request = forgeListRequestSchema.parse(input);
      return (await target(request)).listItems(request);
    },
    async getForgeItem(input) {
      const request = forgeItemRequestSchema.parse(input);
      return (await target(request)).getItem(request);
    },
    async listForgeComments(input) {
      const request = forgePageRequestSchema.parse(input);
      return (await target(request)).listComments(request);
    },
    async listForgeFiles(input) {
      const request = forgePageRequestSchema.parse(input);
      if (request.kind !== "pull-request") throw new Error("FORGE_INVALID_ITEM");
      return (await target(request)).listFiles(request);
    },
    async listForgeLabels(input) {
      const request = forgeTargetRequestSchema.parse(input);
      return (await target(request)).listLabels();
    },
    async createForgeIssue(input) {
      const request = forgeNewIssueRequestSchema.parse(input);
      return (await target(request)).createIssue(request);
    },
    async createForgeComment(input) {
      const request = forgeCommentRequestSchema.parse(input);
      await (await target(request)).createComment(request);
    },
    async setForgeItemState(input) {
      const request = forgeStateRequestSchema.parse(input);
      const adapter = await target(request);
      if ((await adapter.getItem(request)).state === "merged")
        throw new Error("FORGE_MERGE_BLOCKED");
      await adapter.setState(request);
    },
    async mergeForgePullRequest(input) {
      const request = forgeMergeRequestSchema.parse(input);
      const adapter = await target(request);
      const latest = await adapter.getItem(request);
      // PR 在确认期间可能被追加提交；必须重读状态，并用服务端 SHA 条件提交防止合并未评审的代码。
      if (latest.change?.headSha !== request.headSha) throw new Error("FORGE_HEAD_CHANGED");
      if (latest.state !== "open" || latest.draft || latest.change.mergeable !== true)
        throw new Error("FORGE_MERGE_BLOCKED");
      if (!latest.change.mergeMethods.includes(request.method))
        throw new Error("FORGE_MERGE_UNSUPPORTED");
      await adapter.merge(request);
    },
  };
}
