import { z } from "zod";
import type { ForgeComment, ForgePage, ForgePageRequest } from "@zcode/shared";
import { author, labels, page, records, string, type ForgeApiClient } from "./forgeApiClient.js";

const MAX_SOURCE_PAGES = 100;
const timestamp = (value: unknown) => (typeof value === "string" ? Date.parse(value) : 0) || 0;
const labelEventSchema = z.object({
  id: z.number().int().positive().safe(),
  action: z.enum(["add", "remove"]),
  created_at: z.string().refine((value) => Number.isFinite(Date.parse(value))),
  user: z.object({
    id: z.number().int().positive().safe().optional(),
    username: z.string().min(1),
    name: z.string().nullable().optional(),
    avatar_url: z.string().nullable().optional(),
  }),
  label: z
    .object({
      id: z.number().int().positive().safe(),
      name: z.string().min(1),
      color: z.string().nullable().optional(),
    })
    .nullable(),
});

async function readSource(
  api: ForgeApiClient,
  path: string,
  prefix?: number,
): Promise<ForgePage<Record<string, unknown>>> {
  const size = Math.min(100, prefix ?? 100);
  const rows = new Map<string, Record<string, unknown>>();
  for (let sourcePage = 1; sourcePage <= MAX_SOURCE_PAGES; sourcePage++) {
    const response = await api(path, {
      page: sourcePage,
      per_page: size,
      ...(prefix !== undefined ? { sort: "asc", order_by: "created_at" } : {}),
    });
    const batch = records(response.data);
    if (batch.length > size) throw new Error("FORGE_RESPONSE");
    const before = rows.size;
    for (const row of batch) {
      if (
        !(typeof row.id === "string" && row.id.trim()) &&
        !(typeof row.id === "number" && Number.isSafeInteger(row.id) && row.id > 0)
      )
        throw new Error("FORGE_RESPONSE");
      rows.set(String(row.id), row);
    }
    const result = page(batch, response, { page: sourcePage, pageSize: size });
    const next = response.headers.get("x-next-page");
    if (next && next !== String(sourcePage + 1)) throw new Error("FORGE_RESPONSE");
    // 重复页或空页仍宣称有下一页时，不能继续循环并悄悄交付不完整的动态。
    if (result.hasMore && rows.size === before) throw new Error("FORGE_RESPONSE");
    const collected = [...rows.values()];
    // created_at 相同的 notes 可能跨页；看见更晚的时间或源已结束，才能确定稳定 ID 排序的边界。
    const prefixComplete =
      prefix !== undefined &&
      rows.size >= prefix &&
      timestamp(collected.at(-1)?.created_at) > timestamp(collected[prefix - 2]?.created_at);
    if (!result.hasMore || prefixComplete) {
      return { ...result, items: collected };
    }
  }
  throw new Error("FORGE_RESPONSE");
}

function labelActivities(rows: Record<string, unknown>[]): ForgeComment[] {
  const events = rows
    .map((row) => {
      const result = labelEventSchema.safeParse(row);
      if (!result.success) throw new Error("FORGE_RESPONSE");
      return result.data;
    })
    .sort((left, right) => left.id - right.id);
  const groups = new Map<
    string,
    ForgeComment & { labelActivity: NonNullable<ForgeComment["labelActivity"]> }
  >();
  for (const event of events) {
    const key = JSON.stringify([
      event.user.id ?? event.user.username,
      event.created_at,
      event.action,
    ]);
    let activity = groups.get(key);
    if (!activity) {
      activity = {
        id: `label-event:${event.id}`,
        body: "",
        author: author(event.user),
        createdAt: event.created_at,
        url: null,
        system: true,
        labelActivity: { action: event.action, labels: [] },
      };
      groups.set(key, activity);
    }
    const label = event.label ? (labels([event.label], true)[0] ?? null) : null;
    if (!label || !activity.labelActivity.labels.some((entry) => entry?.key === label.key)) {
      activity.labelActivity.labels.push(label);
    }
  }
  return [...groups.values()];
}

export async function listGitlabActivity(
  api: ForgeApiClient,
  itemPath: string,
  request: ForgePageRequest,
): Promise<ForgePage<ForgeComment>> {
  const end = request.page * request.pageSize;
  // 标签变更只在资源事件接口里。先完整分组，再与 notes 前缀合并分页，
  // 不能把标签追加到每个 notes 页，否则翻页会重复、乱序或漏掉跨页批次。
  const [notes, events] = await Promise.all([
    readSource(api, `${itemPath}/notes`, end + 1),
    readSource(api, `${itemPath}/resource_label_events`),
  ]);
  const labelRows = labelActivities(events.items);
  const activity: ForgeComment[] = [
    ...notes.items.map((note) => ({
      id: String(note.id),
      body: string(note.body),
      author: author(note.author),
      createdAt: string(note.created_at) || null,
      url: null,
      system: note.system === true,
    })),
    ...labelRows,
  ];
  activity.sort(
    (left, right) =>
      timestamp(left.createdAt) - timestamp(right.createdAt) ||
      (left.id < right.id ? -1 : left.id > right.id ? 1 : 0),
  );
  return {
    items: activity.slice(end - request.pageSize, end),
    page: request.page,
    pageSize: request.pageSize,
    hasMore: activity.length > end || notes.hasMore,
    total: !notes.hasMore
      ? activity.length
      : notes.total === null
        ? null
        : notes.total + labelRows.length,
  };
}
