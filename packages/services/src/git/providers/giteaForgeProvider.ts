import type { ForgeItemDetail, ForgeMergeMethod } from "@zcode/shared";
import { formatPatch, parsePatch } from "diff";
import type { ForgeProviderAdapter } from "./forgeProvider.js";
import {
  author,
  checkState,
  count,
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

export function createGiteaForgeProvider(
  api: ForgeApiClient,
  repository: string,
): ForgeProviderAdapter {
  const repo = `repos/${repository.split("/").map(encodeURIComponent).join("/")}`;
  return {
    async listItems(request) {
      const response = await api(`${repo}/issues`, {
        type: request.kind === "issue" ? "issues" : "pulls",
        state: request.state,
        page: request.page,
        limit: request.pageSize,
        ...(request.search ? { q: request.search } : {}),
        ...(request.labels.length ? { labels: request.labels.join(",") } : {}),
      });
      const result = page(
        records(response.data).map((raw) => item(raw, request.kind, "gitea")),
        response,
        request,
      );
      return { ...result, reachableTotal: result.total, incomplete: false };
    },
    async getItem(request): Promise<ForgeItemDetail> {
      const raw = record(
        (await api(`${repo}/${request.kind === "issue" ? "issues" : "pulls"}/${request.number}`))
          .data,
      );
      const result: ForgeItemDetail = { ...item(raw, request.kind, "gitea"), change: null };
      if (request.kind === "issue") return result;
      const head = record(raw.head);
      const base = record(raw.base);
      const sha = string(head.sha);
      let checksError: string | null = null;
      let mergeOptionsError: string | null = null;
      const [checks, mergeMethods] = await Promise.all([
        api(`${repo}/commits/${encodeURIComponent(sha)}/statuses`, { limit: 100 })
          .then(({ data }) =>
            records(data).map((check) => ({
              id: String(check.id),
              name: string(check.context),
              state: checkState(check.status),
              url: safeForgeUrl(check.target_url),
            })),
          )
          .catch((error: unknown) => {
            checksError = errorCode(error);
            return [];
          }),
        api(repo)
          .then(({ data }): ForgeMergeMethod[] => {
            const settings = record(data);
            return (
              [
                ["merge", settings.allow_merge_commits !== false],
                ["squash", settings.allow_squash_merge === true],
                ["rebase", settings.allow_rebase === true],
              ] as const
            )
              .filter(([, allowed]) => allowed)
              .map(([method]) => method);
          })
          .catch((error: unknown) => {
            mergeOptionsError = errorCode(error);
            return [];
          }),
      ]);
      result.change = {
        headSha: sha,
        headBranch: string(head.ref),
        baseBranch: string(base.ref),
        mergeable: typeof raw.mergeable === "boolean" ? raw.mergeable : null,
        mergeMethods,
        mergeOptionsError,
        checks,
        checksError,
      };
      return result;
    },
    async listComments(request) {
      const response = await api(`${repo}/issues/${request.number}/comments`, {
        page: request.page,
        limit: request.pageSize,
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
      const [response, patches] = await Promise.all([
        api(`${repo}/pulls/${request.number}/files`, {
          page: request.page,
          limit: request.pageSize,
        }),
        api(`${repo}/pulls/${request.number}.diff`, {}, undefined, "text")
          .then(({ data }) => {
            const parsed = parsePatch(string(data));
            return new Map(
              parsed.map((patch) => [
                (patch.newFileName === "/dev/null"
                  ? (patch.oldFileName ?? "")
                  : (patch.newFileName ?? "")
                ).replace(/^[ab]\//, ""),
                formatPatch(patch),
              ]),
            );
          })
          .catch(() => new Map<string, string>()),
      ]);
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
          patch: patches.get(string(file.filename)) ?? null,
          truncated: false,
        })),
        response,
        request,
      );
    },
    async listLabels() {
      return labels((await api(`${repo}/labels`, { limit: 100 })).data, true);
    },
    async createIssue(request) {
      return item(
        record(
          (
            await api(
              `${repo}/issues`,
              {},
              { method: "POST", body: { title: request.title, body: request.body } },
            )
          ).data,
        ),
        "issue",
        "gitea",
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
      await api(
        `${repo}/${request.kind === "issue" ? "issues" : "pulls"}/${request.number}`,
        {},
        { method: "PATCH", body: { state: request.state } },
      );
    },
    async merge(request) {
      await api(
        `${repo}/pulls/${request.number}/merge`,
        {},
        {
          method: "POST",
          body: {
            do: request.method,
            head_commit_id: request.headSha,
            delete_branch_after_merge: false,
          },
        },
      );
    },
  };
}
