import {
  forgeImagePreviewSchema,
  type ForgeItemDetail,
  type ForgeItemExtras,
  type ForgeItemKind,
  type ForgeMergeMethod,
} from "@zcode/shared";
import {
  readForgeIssueOptions,
  forgeIssueAttributes,
  forgeIssueUpdateAttributes,
} from "./forgeIssueOptions.js";
import type { ForgeProviderAdapter } from "./forgeProvider.js";
import {
  author,
  checkState,
  errorCode,
  item,
  itemMetadata,
  labels,
  page,
  record,
  records,
  string,
  type ForgeApiClient,
} from "./forgeApiClient.js";
import { gitlabUploadApiPath } from "./forgeMedia.js";
import { listGitlabActivity } from "./gitlabForgeActivity.js";
import { gitlabWebUrl } from "./gitlabWebUrl.js";

export function createGitlabForgeProvider(
  api: ForgeApiClient,
  repository: string,
  repositoryUrl?: string,
  media?: {
    readLegacy(url: string): Promise<import("@zcode/shared").ForgeImagePreview>;
    authenticate(url: string): Promise<void>;
  },
): ForgeProviderAdapter {
  const repo = `projects/${encodeURIComponent(repository)}`;
  const itemPath = (request: { kind: string; number: number }) =>
    `${repo}/${request.kind === "issue" ? "issues" : "merge_requests"}/${request.number}`;
  const webUrl = (value: unknown) => gitlabWebUrl(value, repository, repositoryUrl);
  const gitlabItem = (raw: Record<string, unknown>, kind: ForgeItemKind) => ({
    ...item(raw, kind, "gitlab"),
    url: webUrl(raw.web_url),
  });
  return {
    async uploadImage(request) {
      if (!repositoryUrl) throw new Error("FORGE_MEDIA_UNAVAILABLE");
      const form = new FormData();
      form.append(
        "file",
        new Blob([new Uint8Array(Buffer.from(request.dataBase64, "base64"))], {
          type: request.mediaType,
        }),
        request.filename,
      );
      const raw = record((await api(`${repo}/uploads`, {}, { method: "POST", body: form })).data);
      // 上传 API 的 url 相对项目；优先从已绑定项目拼接，兼容部署在子路径下的 GitLab。
      const source = string(raw.url)
        ? `${repositoryUrl.replace(/\/$/, "")}${string(raw.url)}`
        : string(raw.full_path);
      const url = new URL(source, `${repositoryUrl}/`).href;
      gitlabUploadApiPath(repository, repositoryUrl, url);
      return { url };
    },
    async listItems(request) {
      // GitLab 的 closed 不含 merged；按服务端原始页翻页，筛掉 opened/locked 后不能继续展示原始总数。
      const includeMerged = request.kind === "pull-request" && request.state === "closed";
      const response = await api(
        `${repo}/${request.kind === "issue" ? "issues" : "merge_requests"}`,
        {
          state: request.state === "open" ? "opened" : includeMerged ? "all" : request.state,
          page: request.page,
          per_page: request.pageSize,
          scope: "all",
          // 列表默认只返回标签名；请求详情字段，才能沿用与详情页一致的真实标签颜色。
          with_labels_details: "true",
          ...(request.search ? { search: request.search } : {}),
          ...(request.labels.length ? { labels: request.labels.join(",") } : {}),
          order_by: request.sort === "updated" ? "updated_at" : "created_at",
          sort: request.sort === "oldest" ? "asc" : "desc",
        },
      );
      const result = page(
        records(response.data).map((raw) => gitlabItem(raw, request.kind)),
        response,
        request,
      );
      return {
        ...result,
        items: includeMerged ? result.items.filter((row) => row.state !== "open") : result.items,
        total: includeMerged ? null : result.total,
        reachableTotal: includeMerged ? null : result.total,
        incomplete: false,
      };
    },
    async getItem(request): Promise<ForgeItemDetail> {
      const raw = record((await api(itemPath(request))).data);
      const result: ForgeItemDetail = {
        ...gitlabItem(raw, request.kind),
        change: null,
        metadata: itemMetadata(raw, "gitlab"),
      };
      if (result.metadata?.milestone) {
        result.metadata.milestone.url = webUrl(result.metadata.milestone.url);
      }
      if (request.kind === "issue") return result;
      let checksError: string | null = null;
      let mergeOptionsError: string | null = null;
      const [checks, mergeMethods] = await Promise.all([
        api(`${itemPath(request)}/pipelines`, { per_page: 100 })
          .then(({ data }) =>
            records(data).map((pipeline) => ({
              id: String(pipeline.id),
              name: `Pipeline #${pipeline.id}`,
              state: checkState(pipeline.status),
              url: webUrl(pipeline.web_url),
            })),
          )
          .catch((error: unknown) => {
            checksError = errorCode(error);
            return [];
          }),
        api(repo)
          .then(({ data }): ForgeMergeMethod[] => {
            const settings = record(data);
            return settings.squash_option === "always"
              ? ["squash"]
              : settings.squash_option === "never" || !settings.squash_option
                ? ["merge"]
                : ["merge", "squash"];
          })
          .catch((error: unknown) => {
            mergeOptionsError = errorCode(error);
            return [];
          }),
      ]);
      const status = string(raw.detailed_merge_status || raw.merge_status);
      result.change = {
        headSha: string(raw.sha),
        headBranch: string(raw.source_branch),
        baseBranch: string(raw.target_branch),
        mergeable: ["mergeable", "can_be_merged"].includes(status)
          ? true
          : ["unchecked", "checking", "preparing", ""].includes(status)
            ? null
            : false,
        mergeMethods,
        mergeOptionsError,
        checks,
        checksError,
      };
      return result;
    },
    async getItemExtras(request) {
      if (request.kind !== "issue") return {};
      const extras: ForgeItemExtras = {};
      // 附加权限/版本错误不能阻塞正文和关闭议题；解析错误也必须隔离到对应属性。
      const readSection = async (
        section: "participants" | "links" | "labels",
        path: string,
        parse: (response: Awaited<ReturnType<ForgeApiClient>>) => void,
      ) => {
        try {
          parse(await api(path, { per_page: 100, page: 1 }));
        } catch (error) {
          (extras.errors ??= {})[section] = errorCode(error);
        }
      };
      await Promise.all([
        readSection("participants", `${itemPath(request)}/participants`, (response) => {
          const rows = records(response.data);
          extras.participants = rows.map(author);
          extras.participantsHasMore = page(rows, response, { page: 1, pageSize: 100 }).hasMore;
        }),
        readSection("links", `${itemPath(request)}/links`, (response) => {
          const rows = records(response.data);
          extras.linkedItems = rows.map((row) => {
            const related = gitlabItem(row, "issue");
            return {
              number: related.number,
              title: related.title,
              state: related.state,
              url: related.url,
            };
          });
          extras.linkedItemsHasMore = page(rows, response, { page: 1, pageSize: 100 }).hasMore;
        }),
        readSection("labels", `${repo}/labels`, (response) => {
          extras.labels = labels(records(response.data));
        }),
      ]);
      return extras;
    },
    async readImage(request) {
      if (!repositoryUrl) throw new Error("FORGE_MEDIA_UNAVAILABLE");
      const path = gitlabUploadApiPath(repository, repositoryUrl, request.url);
      try {
        return forgeImagePreviewSchema.parse((await api(path, {}, undefined, "image")).data);
      } catch (error) {
        // 17.4 才提供下载 API。仅 404 使用旧版附件路径，鉴权/解析失败不能绕过原接口。
        if (errorCode(error) !== "FORGE_NOT_FOUND" || !media) throw error;
        return media.readLegacy(request.url);
      }
    },
    async authenticateImage(request) {
      if (!repositoryUrl || !media) throw new Error("FORGE_MEDIA_AUTHENTICATION_UNAVAILABLE");
      gitlabUploadApiPath(repository, repositoryUrl, request.url);
      await media.authenticate(request.url);
    },
    async listComments(request) {
      return listGitlabActivity(api, itemPath(request), request);
    },
    async listFiles(request) {
      const response = await api(`${itemPath(request)}/diffs`, {
        page: request.page,
        per_page: request.pageSize,
      });
      return page(
        records(response.data).map((file) => ({
          path: string(file.new_path || file.old_path),
          previousPath: file.renamed_file ? string(file.old_path) : null,
          status: file.new_file
            ? ("added" as const)
            : file.deleted_file
              ? ("removed" as const)
              : file.renamed_file
                ? ("renamed" as const)
                : ("modified" as const),
          additions: string(file.diff)
            .split("\n")
            .filter((line) => line.startsWith("+") && !line.startsWith("+++")).length,
          deletions: string(file.diff)
            .split("\n")
            .filter((line) => line.startsWith("-") && !line.startsWith("---")).length,
          patch: typeof file.diff === "string" && file.diff ? file.diff : null,
          truncated: file.too_large === true || file.collapsed === true,
        })),
        response,
        request,
      );
    },
    async listLabels() {
      return labels((await api(`${repo}/labels`, { per_page: 100 })).data);
    },
    getIssueOptions() {
      return readForgeIssueOptions(api, repo, "gitlab");
    },
    async createIssue(request) {
      return gitlabItem(
        record(
          (
            await api(
              `${repo}/issues`,
              {},
              {
                method: "POST",
                body: {
                  title: request.title,
                  description: request.body,
                  ...forgeIssueAttributes(request, "gitlab"),
                },
              },
            )
          ).data,
        ),
        "issue",
      );
    },
    async updateIssue(request) {
      return gitlabItem(
        record(
          (
            await api(
              itemPath(request),
              {},
              {
                method: "PUT",
                body: {
                  title: request.title,
                  description: request.body,
                  ...forgeIssueUpdateAttributes(request, "gitlab"),
                },
              },
            )
          ).data,
        ),
        "issue",
      );
    },
    async createComment(request) {
      await api(`${itemPath(request)}/notes`, {}, { method: "POST", body: { body: request.body } });
    },
    async setState(request) {
      await api(
        itemPath(request),
        {},
        { method: "PUT", body: { state_event: request.state === "open" ? "reopen" : "close" } },
      );
    },
    async merge(request) {
      if (request.method === "rebase") throw new Error("FORGE_MERGE_UNSUPPORTED");
      const result = record(
        (
          await api(
            `${itemPath(request)}/merge`,
            {},
            {
              method: "PUT",
              body: {
                sha: request.headSha,
                squash: request.method === "squash",
                should_remove_source_branch: false,
              },
            },
          )
        ).data,
      );
      if (result.state !== "merged") throw new Error("FORGE_CONFLICT");
    },
  };
}
