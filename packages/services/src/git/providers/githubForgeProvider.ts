import type { ForgeCheck, ForgeItemDetail, ForgeMergeMethod } from "@zcode/shared";
import { readForgeIssueOptions, forgeIssueAttributes } from "./forgeIssueOptions.js";
import type { ForgeProviderAdapter } from "./forgeProvider.js";
import {
  author,
  checkState,
  count,
  errorCode,
  item,
  itemMetadata,
  labels,
  page,
  record,
  records,
  safeForgeUrl,
  string,
  type ForgeApiClient,
} from "./forgeApiClient.js";

const quoteSearch = (value: string) =>
  `"${value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/[\r\n]/g, " ")}"`;

export function createGithubForgeProvider(
  api: ForgeApiClient,
  repository: string,
): ForgeProviderAdapter {
  const repo = `repos/${repository.split("/").map(encodeURIComponent).join("/")}`;
  const itemPath = (request: { kind: string; number: number }) =>
    `${repo}/${request.kind === "issue" ? "issues" : "pulls"}/${request.number}`;
  return {
    async listItems(request) {
      const query = [
        `repo:${repository}`,
        request.kind === "issue" ? "is:issue" : "is:pr",
        ...(request.state === "all" ? [] : [`is:${request.state}`]),
        ...(request.search ? [quoteSearch(request.search), "in:title,body"] : []),
        ...request.labels.map((label) => `label:${quoteSearch(label)}`),
      ].join(" ");
      const response = await api("search/issues", {
        q: query,
        page: request.page,
        per_page: request.pageSize,
        sort: request.sort === "updated" ? "updated" : "created",
        order: request.sort === "oldest" ? "asc" : "desc",
      });
      const data = record(response.data);
      const total = count(data.total_count);
      const reachableTotal = Math.min(total, 1000);
      return {
        items: records(data.items).map((row) => item(row, request.kind, "github")),
        page: request.page,
        pageSize: request.pageSize,
        total,
        reachableTotal,
        incomplete: data.incomplete_results === true,
        hasMore: request.page * request.pageSize < reachableTotal,
      };
    },
    async getItem(request): Promise<ForgeItemDetail> {
      const raw = record((await api(itemPath(request))).data);
      const result: ForgeItemDetail = {
        ...item(raw, request.kind, "github"),
        change: null,
        metadata: itemMetadata(raw, "github"),
      };
      if (request.kind === "issue") return result;
      const head = record(raw.head);
      const base = record(raw.base);
      const sha = string(head.sha);
      const checks: ForgeCheck[] = [];
      const errors: string[] = [];
      let mergeMethods: ForgeMergeMethod[] = [];
      let mergeOptionsError: string | null = null;
      // Checks 和 legacy commit statuses 有独立权限；其中一个失败不能吞掉另一个的结果。
      await Promise.all([
        api(`${repo}/commits/${encodeURIComponent(sha)}/check-runs`, { per_page: 100 })
          .then(({ data }) => {
            checks.push(
              ...records(record(data).check_runs).map((check) => ({
                id: `check:${check.id}`,
                name: string(check.name),
                state:
                  check.status === "completed"
                    ? checkState(check.conclusion)
                    : ("pending" as const),
                url: safeForgeUrl(check.html_url),
              })),
            );
          })
          .catch((error: unknown) => errors.push(errorCode(error))),
        api(`${repo}/commits/${encodeURIComponent(sha)}/status`, { per_page: 100 })
          .then(({ data }) => {
            checks.push(
              ...records(record(data).statuses).map((check) => ({
                id: `status:${check.id}`,
                name: string(check.context),
                state: checkState(check.state),
                url: safeForgeUrl(check.target_url),
              })),
            );
          })
          .catch((error: unknown) => errors.push(errorCode(error))),
        api(repo)
          .then(({ data }) => {
            const settings = record(data);
            mergeMethods = (
              [
                ["merge", settings.allow_merge_commit],
                ["squash", settings.allow_squash_merge],
                ["rebase", settings.allow_rebase_merge],
              ] as const
            )
              .filter(([, allowed]) => allowed !== false)
              .map(([method]) => method);
          })
          .catch((error: unknown) => {
            mergeOptionsError = errorCode(error);
          }),
      ]);
      result.change = {
        headSha: sha,
        headBranch: string(head.ref),
        baseBranch: string(base.ref),
        mergeable:
          raw.mergeable_state === "blocked"
            ? false
            : typeof raw.mergeable === "boolean"
              ? raw.mergeable
              : null,
        mergeMethods,
        mergeOptionsError,
        checks,
        checksError: errors[0] ?? null,
      };
      return result;
    },
    async listComments(request) {
      const response = await api(`${repo}/issues/${request.number}/comments`, {
        page: request.page,
        per_page: request.pageSize,
      });
      return page(
        records(response.data).map((comment) => ({
          id: String(comment.id),
          body: string(comment.body),
          author: author(comment.user),
          createdAt: string(comment.created_at) || null,
          url: safeForgeUrl(comment.html_url),
        })),
        response,
        request,
      );
    },
    async listFiles(request) {
      const response = await api(`${repo}/pulls/${request.number}/files`, {
        page: request.page,
        per_page: request.pageSize,
      });
      return page(
        records(response.data).map((file) => ({
          path: string(file.filename),
          previousPath: string(file.previous_filename) || null,
          status:
            file.status === "added" || file.status === "removed" || file.status === "renamed"
              ? file.status
              : ("modified" as const),
          additions: count(file.additions),
          deletions: count(file.deletions),
          patch: typeof file.patch === "string" ? file.patch : null,
          truncated: false,
        })),
        response,
        request,
      );
    },
    async listLabels() {
      return labels((await api(`${repo}/labels`, { per_page: 100 })).data);
    },
    getIssueOptions() {
      return readForgeIssueOptions(api, repo, "github");
    },
    async createIssue(request) {
      return item(
        record(
          (
            await api(
              `${repo}/issues`,
              {},
              {
                method: "POST",
                body: {
                  title: request.title,
                  body: request.body,
                  ...forgeIssueAttributes(request, "github"),
                },
              },
            )
          ).data,
        ),
        "issue",
        "github",
      );
    },
    async createComment(request) {
      await api(
        `${repo}/issues/${request.number}/comments`,
        {},
        { method: "POST", body: { body: request.body } },
      );
    },
    async setState(request) {
      await api(itemPath(request), {}, { method: "PATCH", body: { state: request.state } });
    },
    async merge(request) {
      const result = record(
        (
          await api(
            `${repo}/pulls/${request.number}/merge`,
            {},
            { method: "PUT", body: { sha: request.headSha, merge_method: request.method } },
          )
        ).data,
      );
      if (result.merged !== true) throw new Error("FORGE_CONFLICT");
    },
  };
}
