import type { ForgeItemDetail, ForgeMergeMethod } from "@zcode/shared";
import type { ForgeProviderAdapter } from "./forgeProvider.js";
import {
  author,
  checkState,
  errorCode,
  item,
  labels,
  page,
  record,
  records,
  safeForgeUrl,
  string,
  type ForgeApiClient,
} from "./forgeApiClient.js";

export function createGitlabForgeProvider(
  api: ForgeApiClient,
  repository: string,
): ForgeProviderAdapter {
  const repo = `projects/${encodeURIComponent(repository)}`;
  const itemPath = (request: { kind: string; number: number }) =>
    `${repo}/${request.kind === "issue" ? "issues" : "merge_requests"}/${request.number}`;
  return {
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
          ...(request.search ? { search: request.search } : {}),
          ...(request.labels.length ? { labels: request.labels.join(",") } : {}),
          order_by: request.sort === "updated" ? "updated_at" : "created_at",
          sort: request.sort === "oldest" ? "asc" : "desc",
        },
      );
      const result = page(
        records(response.data).map((raw) => item(raw, request.kind, "gitlab")),
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
      const result: ForgeItemDetail = { ...item(raw, request.kind, "gitlab"), change: null };
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
              url: safeForgeUrl(pipeline.web_url),
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
    async listComments(request) {
      const response = await api(`${itemPath(request)}/notes`, {
        page: request.page,
        per_page: request.pageSize,
        sort: "asc",
        order_by: "created_at",
      });
      const all = records(response.data);
      const result = page(all, response, request);
      return {
        ...result,
        items: all
          .filter((note) => !note.system)
          .map((note) => ({
            id: String(note.id),
            body: string(note.body),
            author: author(note.author),
            createdAt: string(note.created_at) || null,
            url: null,
          })),
      };
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
    async createIssue(request) {
      return item(
        record(
          (
            await api(
              `${repo}/issues`,
              {},
              { method: "POST", body: { title: request.title, description: request.body } },
            )
          ).data,
        ),
        "issue",
        "gitlab",
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
