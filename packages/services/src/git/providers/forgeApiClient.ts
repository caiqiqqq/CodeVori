import type {
  ForgeAuthor,
  ForgeCheck,
  ForgeItem,
  ForgeItemKind,
  ForgeLabel,
  ForgePage,
  ForgeItemMetadata,
} from "@zcode/shared";
import { z } from "zod";
import { createServiceLogger } from "../../logger/serviceLogger.js";
import { readForgeImageResponse } from "./forgeMedia.js";

const logger = createServiceLogger("ForgeApiClient");

export interface ForgeApiResponse {
  data: unknown;
  headers: Headers;
}
export type ForgeApiClient = (
  path: string,
  query?: Record<string, string | number | undefined>,
  write?: { method: "POST" | "PUT" | "PATCH"; body: unknown },
  format?: "json" | "text" | "image",
) => Promise<ForgeApiResponse>;

export function createForgeApiClient(options: {
  baseUrl: string;
  provider: "github" | "gitlab" | "gitea";
  secret: string;
  fetcher: typeof fetch;
}): ForgeApiClient {
  return async (path, query = {}, write, format = "json") => {
    const failure = (code: string, phase: "http" | "network" | "response", response?: Response) => {
      const rawId = response?.headers.get(
        options.provider === "github" ? "x-github-request-id" : "x-request-id",
      );
      const idPattern = options.provider === "github" ? /^[a-f\d:]{1,128}$/i : /^[\w-]{1,128}$/;
      // #175 的 HTTP 失败曾只留下 FORGE_RESPONSE；只记录有限元数据，不能记录仓库 URL 或正文。
      logger.warn(undefined, "request failed", {
        provider: options.provider,
        method: write?.method ?? "GET",
        phase,
        status: response?.status ?? null,
        requestId: rawId && idPattern.test(rawId) ? rawId : null,
      });
      return Object.assign(new Error(`FORGE_${code}`), response ? { status: response.status } : {});
    };
    const url = new URL(`${options.baseUrl}/${path.replace(/^\//, "")}`);
    for (const [key, value] of Object.entries(query))
      if (value !== undefined) url.searchParams.set(key, String(value));
    const headers = new Headers({
      Accept:
        format === "json"
          ? "application/json"
          : format === "image"
            ? "image/png,image/jpeg,image/gif,image/webp,image/avif"
            : "text/plain",
      "User-Agent": "ZCode",
    });
    if (options.provider === "gitlab") headers.set("PRIVATE-TOKEN", options.secret);
    else
      headers.set(
        "Authorization",
        `${options.provider === "gitea" ? "token" : "Bearer"} ${options.secret}`,
      );
    const multipart = write?.body instanceof FormData;
    if (write && !multipart) headers.set("Content-Type", "application/json");
    let response: Response;
    try {
      response = await options.fetcher(url.href, {
        headers,
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
        ...(write
          ? {
              method: write.method,
              body: multipart ? (write.body as FormData) : JSON.stringify(write.body),
            }
          : {}),
      });
    } catch {
      throw failure("NETWORK", "network");
    }
    if (!response.ok) {
      // 取消错误响应流也可能失败，不能用清理异常覆盖服务端原始状态或泄露底层错误。
      await response.body?.cancel().catch(() => {});
      const githubRateLimit =
        options.provider === "github" &&
        (response.headers.get("x-ratelimit-remaining") === "0" ||
          /^\d+$/.test(response.headers.get("retry-after") ?? ""));
      const code =
        response.status >= 500
          ? "SERVER_ERROR"
          : response.status === 400
            ? "BAD_REQUEST"
            : response.status === 401
              ? "AUTHENTICATION"
              : response.status === 403
                ? githubRateLimit
                  ? "RATE_LIMIT"
                  : "FORBIDDEN"
                : response.status === 404
                  ? "NOT_FOUND"
                  : response.status === 429
                    ? "RATE_LIMIT"
                    : response.status === 409 || response.status === 405 || response.status === 422
                      ? "CONFLICT"
                      : "HTTP_ERROR";
      throw failure(code, "http", response);
    }
    try {
      if (response.status === 204) return { data: null, headers: response.headers };
      if (format === "image")
        return { data: await readForgeImageResponse(response), headers: response.headers };
      const reader = response.body?.getReader();
      if (!reader) throw new Error("Missing response");
      const chunks: Uint8Array[] = [];
      let size = 0;
      // 外部仓库的正文和 diff 不可信；限制真实读取量，不能只相信 Content-Length。
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > (format === "text" ? 2 : 8) * 1024 * 1024) {
          await reader.cancel();
          throw new Error("Response too large");
        }
        chunks.push(value);
      }
      const bytes = Buffer.concat(chunks);
      const text = bytes.toString("utf8");
      return { data: format === "text" ? text : JSON.parse(text), headers: response.headers };
    } catch {
      throw failure("RESPONSE", "response", response);
    }
  };
}

const recordSchema = z.record(z.string(), z.unknown());
export function record(value: unknown): Record<string, unknown> {
  const result = recordSchema.safeParse(value);
  if (!result.success) throw new Error("FORGE_RESPONSE");
  return result.data;
}
export function records(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) throw new Error("FORGE_RESPONSE");
  return value.map(record);
}
export const string = (value: unknown): string => (typeof value === "string" ? value : "");
export const count = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : 0;
export function safeForgeUrl(value: unknown): string | null {
  try {
    const url = new URL(string(value));
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}
export function author(value: unknown): ForgeAuthor {
  const raw = value && typeof value === "object" ? record(value) : {};
  return {
    username: string(raw.login || raw.username) || "unknown",
    avatarUrl: safeForgeUrl(raw.avatar_url),
    ...(string(raw.name) ? { displayName: string(raw.name) } : {}),
  };
}
export function itemMetadata(
  raw: Record<string, unknown>,
  provider: "github" | "gitlab" | "gitea",
): ForgeItemMetadata {
  const milestone =
    raw.milestone && typeof raw.milestone === "object" ? record(raw.milestone) : null;
  const assignees = Array.isArray(raw.assignees)
    ? raw.assignees
    : raw.assignee
      ? [raw.assignee]
      : [];
  const result: ForgeItemMetadata = {
    assignees: assignees.map(author),
    milestone:
      milestone && string(milestone.title)
        ? {
            title: string(milestone.title),
            url: safeForgeUrl(milestone.web_url || milestone.html_url),
          }
        : null,
  };
  if (provider === "gitlab") {
    const stats =
      raw.time_stats && typeof raw.time_stats === "object" ? record(raw.time_stats) : null;
    const tasks =
      raw.task_completion_status && typeof raw.task_completion_status === "object"
        ? record(raw.task_completion_status)
        : null;
    result.dueDate = /^\d{4}-\d{2}-\d{2}$/.test(string(raw.due_date)) ? string(raw.due_date) : null;
    result.confidential = typeof raw.confidential === "boolean" ? raw.confidential : null;
    result.timeStats = stats
      ? { estimateSeconds: count(stats.time_estimate), spentSeconds: count(stats.total_time_spent) }
      : null;
    if (tasks)
      result.taskStatus = {
        total: count(tasks.count),
        completed: Math.min(count(tasks.count), count(tasks.completed_count)),
      };
  } else if (provider === "gitea" && raw.due_date) {
    result.dueDate = string(raw.due_date) || null;
  }
  return result;
}
export function labels(value: unknown, ids = false): ForgeLabel[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const raw = typeof entry === "string" ? { name: entry } : record(entry);
    const name = string(raw.name);
    if (!name) return [];
    const color = string(raw.color).replace(/^#/, "");
    return [
      {
        key: ids ? String(raw.id) : name,
        name,
        color: /^[a-f\d]{6}$/i.test(color) ? `#${color}` : null,
      },
    ];
  });
}
export function item(
  raw: Record<string, unknown>,
  kind: ForgeItemKind,
  provider: "github" | "gitlab" | "gitea",
): ForgeItem {
  const number = count(provider === "gitlab" ? raw.iid : raw.number);
  const title = string(raw.title);
  if (!number || !Number.isSafeInteger(number) || !title) throw new Error("FORGE_RESPONSE");
  const pull =
    raw.pull_request && typeof raw.pull_request === "object" ? record(raw.pull_request) : {};
  return {
    number,
    kind,
    title,
    body: string(provider === "gitlab" ? raw.description : raw.body),
    state:
      raw.merged === true ||
      raw.state === "merged" ||
      raw.merged_at ||
      pull.merged === true ||
      pull.merged_at
        ? "merged"
        : raw.state === "closed"
          ? "closed"
          : "open",
    draft:
      raw.draft === true ||
      raw.work_in_progress === true ||
      (provider === "gitea" && /^(WIP:|\[WIP\])/i.test(title)),
    author: author(provider === "gitlab" ? raw.author : raw.user),
    url: safeForgeUrl(provider === "gitlab" ? raw.web_url : raw.html_url),
    createdAt: string(raw.created_at) || null,
    updatedAt: string(raw.updated_at) || null,
    labels: labels(raw.labels, provider === "gitea"),
    commentCount: count(raw.comments ?? raw.user_notes_count),
  };
}
export function page<T>(
  items: T[],
  response: ForgeApiResponse,
  request: { page: number; pageSize: number },
): ForgePage<T> {
  const rawTotal = response.headers.get("x-total") ?? response.headers.get("x-total-count");
  const total = rawTotal !== null && /^\d+$/.test(rawTotal) ? Number(rawTotal) : null;
  const next = response.headers.get("x-next-page");
  const link = response.headers.get("link");
  return {
    items,
    ...request,
    total,
    hasMore:
      next !== null
        ? Boolean(next)
        : link !== null
          ? link.includes('rel="next"')
          : total !== null
            ? request.page * request.pageSize < total
            : items.length === request.pageSize,
  };
}
export function checkState(value: unknown): ForgeCheck["state"] {
  return ["success", "passed"].includes(string(value))
    ? "success"
    : [
          "failure",
          "failed",
          "error",
          "timed_out",
          "cancelled",
          "canceled",
          "action_required",
        ].includes(string(value))
      ? "failure"
      : ["pending", "running", "queued", "in_progress", "waiting", "created", "preparing"].includes(
            string(value),
          )
        ? "pending"
        : "neutral";
}
export function errorCode(error: unknown): string {
  return error instanceof Error && /^FORGE_[A-Z_]+$/.test(error.message)
    ? error.message
    : "FORGE_RESPONSE";
}
