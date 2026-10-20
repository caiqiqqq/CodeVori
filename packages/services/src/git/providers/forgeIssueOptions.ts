import type {
  ForgeIssueOptions,
  ForgeNewIssueRequest,
  ForgeProvider,
  ForgeUpdateIssueRequest,
} from "@zcode/shared";
import {
  author,
  errorCode,
  labels,
  page,
  records,
  string,
  type ForgeApiClient,
} from "./forgeApiClient.js";

// 创建属性必须读完服务端分页；截断候选项会让界面与 Git 平台的可选项不一致。
async function catalog(api: ForgeApiClient, path: string, provider: ForgeProvider, query = {}) {
  const rows: Record<string, unknown>[] = [];
  for (let current = 1; current <= 100; current += 1) {
    const response = await api(path, {
      ...query,
      page: current,
      [provider === "gitea" ? "limit" : "per_page"]: 100,
    });
    const result = page(records(response.data), response, { page: current, pageSize: 100 });
    rows.push(...result.items);
    if (!result.hasMore) return rows;
    const next = response.headers.get("x-next-page");
    if (!result.items.length || (next && Number(next) !== current + 1))
      throw new Error("FORGE_RESPONSE");
  }
  throw new Error("FORGE_RESPONSE");
}

const numericKey = (value: unknown) => {
  const key = String(value ?? "");
  if (!/^[1-9]\d*$/.test(key) || !Number.isSafeInteger(Number(key)))
    throw new Error("FORGE_RESPONSE");
  return key;
};

export async function readForgeIssueOptions(
  api: ForgeApiClient,
  repo: string,
  provider: ForgeProvider,
): Promise<ForgeIssueOptions> {
  const section = async <T>(read: () => Promise<T[]>) => {
    try {
      return { items: await read(), error: null };
    } catch (error) {
      return { items: [] as T[], error: errorCode(error) };
    }
  };
  const [labelSection, assignees, milestones] = await Promise.all([
    section(async () =>
      labels(await catalog(api, `${repo}/labels`, provider), provider === "gitea"),
    ),
    section(async () =>
      (
        await catalog(
          api,
          `${repo}/${provider === "gitlab" ? "members/all" : "assignees"}`,
          provider,
        )
      ).map((raw) => {
        const user = author(raw);
        const key = provider === "gitlab" ? numericKey(raw.id) : string(raw.login || raw.username);
        if (!key) throw new Error("FORGE_RESPONSE");
        return { ...user, key };
      }),
    ),
    section(async () =>
      (
        await catalog(api, `${repo}/milestones`, provider, {
          state: provider === "gitlab" ? "active" : "open",
        })
      ).map((raw) => {
        const title = string(raw.title);
        if (!title) throw new Error("FORGE_RESPONSE");
        return { key: numericKey(provider === "github" ? raw.number : raw.id), title };
      }),
    ),
  ]);
  return { labels: labelSection, assignees, milestones };
}

export function forgeIssueAttributes(request: ForgeNewIssueRequest, provider: ForgeProvider) {
  if (provider === "github" && (request.assignees?.length ?? 0) > 10)
    throw new Error("FORGE_INVALID_ITEM");
  if (
    provider !== "gitlab" &&
    (request.confidential !== undefined || request.dueDate !== undefined)
  )
    throw new Error("FORGE_INVALID_ITEM");
  const integer = (key: string) => {
    if (!/^[1-9]\d*$/.test(key) || !Number.isSafeInteger(Number(key)))
      throw new Error("FORGE_INVALID_ITEM");
    return Number(key);
  };
  if (provider === "gitlab" && request.labels?.some((label) => label.includes(",")))
    throw new Error("FORGE_INVALID_ITEM");
  return provider === "gitlab"
    ? {
        ...(request.labels?.length ? { labels: request.labels.join(",") } : {}),
        ...(request.assignees?.length ? { assignee_ids: request.assignees.map(integer) } : {}),
        ...(request.milestone ? { milestone_id: integer(request.milestone) } : {}),
        ...(request.confidential !== undefined ? { confidential: request.confidential } : {}),
        ...(request.dueDate ? { due_date: request.dueDate } : {}),
      }
    : {
        ...(request.labels?.length
          ? { labels: provider === "gitea" ? request.labels.map(integer) : request.labels }
          : {}),
        ...(request.assignees?.length ? { assignees: request.assignees } : {}),
        ...(request.milestone ? { milestone: integer(request.milestone) } : {}),
      };
}

export function forgeIssueUpdateAttributes(
  request: ForgeUpdateIssueRequest,
  provider: ForgeProvider,
) {
  if (provider === "github" && request.assignees.length > 10) throw new Error("FORGE_INVALID_ITEM");
  if (
    provider !== "gitlab" &&
    (request.confidential !== undefined || request.dueDate !== undefined)
  )
    throw new Error("FORGE_INVALID_ITEM");
  const integer = (key: string) => {
    if (!/^[1-9]\d*$/.test(key) || !Number.isSafeInteger(Number(key)))
      throw new Error("FORGE_INVALID_ITEM");
    return Number(key);
  };
  if (provider === "gitlab" && request.labels.some((label) => label.includes(",")))
    throw new Error("FORGE_INVALID_ITEM");
  return provider === "gitlab"
    ? {
        labels: request.labels.join(","),
        assignee_ids: request.assignees.map(integer),
        milestone_id: request.milestone === null ? null : integer(request.milestone),
        ...(request.confidential !== undefined ? { confidential: request.confidential } : {}),
        ...(request.dueDate !== undefined ? { due_date: request.dueDate } : {}),
      }
    : {
        labels: provider === "gitea" ? request.labels.map(integer) : request.labels,
        assignees: request.assignees,
        milestone: request.milestone === null ? null : integer(request.milestone),
      };
}
