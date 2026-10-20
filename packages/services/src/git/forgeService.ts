import {
  forgeCommentRequestSchema,
  forgeItemRequestSchema,
  forgeListRequestSchema,
  forgeMergeRequestSchema,
  forgeNewIssueRequestSchema,
  forgeUpdateIssueRequestSchema,
  forgePageRequestSchema,
  forgeRepositoryRequestSchema,
  forgeStateRequestSchema,
  forgeTargetRequestSchema,
  forgeImagePreviewSchema,
  type ForgeWebMediaPort,
  type ForgeRepositoryInfo,
  type ForgeRepositoryRequest,
  type ForgeTargetRequest,
} from "@zcode/shared";
import type { IGitService } from "./git.js";
import { createForgeImageUploads } from "./forgeImageUploads.js";
import { createForgeImageReads } from "./forgeImageReads.js";
import { createGitCliRepo } from "./repo/gitCliRepo.js";
import type { GitCliRepo } from "./repo/gitCliTypes.js";
import { createVersionControlRepo, type VersionControlRepo } from "./repo/versionControlRepo.js";
import {
  createGitCommandProvider,
  type GitCommandProvider,
} from "./providers/gitCommandProvider.js";
import { createForgeApiClient, record } from "./providers/forgeApiClient.js";
import { gitlabWebLoginUrl, readForgeImageResponse } from "./providers/forgeMedia.js";
import {
  forgeRepository,
  knownForgeProvider,
  parseForgeRemote,
  selectForgeAccount,
} from "./providers/forgeRemote.js";
import { createGithubForgeProvider } from "./providers/githubForgeProvider.js";
import { readGithubAttachmentImage } from "./providers/githubForgeMedia.js";
import { readGiteaAttachmentImage } from "./providers/giteaForgeMedia.js";
import { createGitlabForgeProvider } from "./providers/gitlabForgeProvider.js";
import { createGiteaForgeProvider } from "./providers/giteaForgeProvider.js";

export type ForgeService = Pick<
  IGitService,
  | "getForgeImageUploadCapability"
  | "uploadForgeImage"
  | "getForgeRepository"
  | "listForgeItems"
  | "getForgeItem"
  | "getForgeItemExtras"
  | "readForgeImage"
  | "authenticateForgeImage"
  | "listForgeComments"
  | "listForgeFiles"
  | "listForgeLabels"
  | "getForgeIssueOptions"
  | "createForgeIssue"
  | "updateForgeIssue"
  | "createForgeComment"
  | "setForgeItemState"
  | "mergeForgePullRequest"
>;

export function createForgeService(options?: {
  gitRepo?: Pick<GitCliRepo, "resolveRepository">;
  commandProvider?: GitCommandProvider;
  credentials?: VersionControlRepo;
  fetcher?: typeof fetch;
  webMedia?: ForgeWebMediaPort;
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
      return {
        info: { ...empty, status: "git-unavailable" as const },
        adapter: null,
        account: null,
      };
    if (!resolution.isRepository)
      return {
        info: { ...empty, status: "not-repository" as const },
        adapter: null,
        account: null,
      };
    const names = await commands.run({ cwd: resolution.repoRoot, args: ["remote"] });
    if (names.exitCode !== 0) throw new Error("FORGE_RESPONSE");
    const remoteNames = names.stdout.trim().split(/\r?\n/).filter(Boolean);
    const remoteName =
      request.remoteName ?? (remoteNames.includes("origin") ? "origin" : (remoteNames[0] ?? null));
    const info = { ...empty, remoteNames, remoteName };
    if (!remoteName || !remoteNames.includes(remoteName))
      return { info, adapter: null, account: null };
    const remoteResult = await commands.run({
      cwd: resolution.repoRoot,
      args: ["remote", "get-url", remoteName],
    });
    if (remoteResult.exitCode !== 0) throw new Error("FORGE_RESPONSE");
    const remote = parseForgeRemote(remoteResult.stdout.trim());
    if (!remote)
      return { info: { ...info, status: "unsupported" as const }, adapter: null, account: null };
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
        account: null,
      };
    }
    const resolved = forgeRepository(remote, account);
    if (!resolved)
      return { info: { ...info, status: "unsupported" as const }, adapter: null, account: null };
    const api = createForgeApiClient({
      baseUrl: resolved.apiBase,
      provider: resolved.repository.provider,
      secret: account.secret,
      fetcher: options?.fetcher ?? fetch,
    });
    const mediaContext = async (url: string) => {
      const project = record(
        (await api(`projects/${encodeURIComponent(resolved.repository.name)}`)).data,
      );
      return {
        accountId: account.id,
        username: account.username,
        serverUrl: account.serverUrl,
        repository: resolved.repository.name,
        repositoryUrl: resolved.repository.url,
        url,
        loginUrl: gitlabWebLoginUrl(
          resolved.repository.name,
          project.path_with_namespace,
          project.web_url,
        ),
      };
    };
    const adapter =
      resolved.repository.provider === "github"
        ? createGithubForgeProvider(api, resolved.repository.name, (url) =>
            readGithubAttachmentImage(
              resolved.repository,
              url,
              account.secret,
              options?.fetcher ?? fetch,
            ),
          )
        : resolved.repository.provider === "gitlab"
          ? createGitlabForgeProvider(api, resolved.repository.name, resolved.repository.url, {
              async readLegacy(url) {
                // 旧版的公开附件可直接读取；私有附件必须交给账户隔离的原生会话，不能给网页发送 PAT。
                let response: Response;
                try {
                  response = await (options?.fetcher ?? fetch)(url, {
                    redirect: "manual",
                    credentials: "omit",
                    signal: AbortSignal.timeout(15_000),
                    headers: { Accept: "image/png,image/jpeg,image/gif,image/webp,image/avif" },
                  });
                } catch {
                  throw new Error("FORGE_NETWORK");
                }
                try {
                  return await readForgeImageResponse(response);
                } catch (error) {
                  if (!(error instanceof Error) || error.message !== "FORGE_MEDIA_AUTHENTICATION")
                    throw error;
                  if (!options?.webMedia) throw new Error("FORGE_MEDIA_AUTHENTICATION_UNAVAILABLE");
                  return forgeImagePreviewSchema.parse(
                    await options.webMedia.read(await mediaContext(url)),
                  );
                }
              },
              async authenticate(url) {
                if (!options?.webMedia) throw new Error("FORGE_MEDIA_AUTHENTICATION_UNAVAILABLE");
                await options.webMedia.authenticate(await mediaContext(url));
              },
            })
          : createGiteaForgeProvider(api, resolved.repository.name, (url) =>
              readGiteaAttachmentImage(
                resolved.repository,
                url,
                account.secret,
                options?.fetcher ?? fetch,
              ),
            );
    return {
      info: {
        ...info,
        status: "ready" as const,
        repository: resolved.repository,
        provider: resolved.repository.provider,
      },
      adapter,
      account,
    };
  };
  const verifiedTarget = async (request: ForgeTargetRequest) => {
    const { info, adapter, account } = await resolve(request);
    if (
      info.status === "missing-account" ||
      info.status === "account-mismatch" ||
      (info.status === "unsupported" && request.accountId)
    )
      throw new Error("FORGE_MISSING_ACCOUNT");
    if (!adapter || !account || !info.repository || info.repository.key !== request.repositoryKey)
      throw new Error("FORGE_TARGET_CHANGED");
    return { adapter, account, repository: info.repository };
  };
  const target = async (request: ForgeTargetRequest) => (await verifiedTarget(request)).adapter;
  return {
    ...createForgeImageUploads(verifiedTarget, options?.webMedia),
    ...createForgeImageReads(verifiedTarget),
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
    async getForgeItemExtras(input) {
      const request = forgeItemRequestSchema.parse(input);
      const adapter = await target(request);
      return adapter.getItemExtras ? adapter.getItemExtras(request) : {};
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
    async getForgeIssueOptions(input) {
      const request = forgeTargetRequestSchema.parse(input);
      return (await target(request)).getIssueOptions();
    },
    async createForgeIssue(input) {
      const request = forgeNewIssueRequestSchema.parse(input);
      return (await target(request)).createIssue(request);
    },
    async updateForgeIssue(input) {
      const request = forgeUpdateIssueRequestSchema.parse(input);
      return (await target(request)).updateIssue(request);
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
