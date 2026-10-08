import { z } from "zod";

export type ForgeProvider = "github" | "gitlab" | "gitea";
export type ForgeItemKind = "issue" | "pull-request";
export type ForgeItemState = "open" | "closed" | "merged";
export type ForgeSort = "newest" | "oldest" | "updated";
export type ForgeMergeMethod = "merge" | "squash" | "rebase";

export const forgeRepositoryRequestSchema = z.object({
  workspacePath: z.string().trim().min(1).max(8192),
  workspaceIdentity: z.string().trim().min(1).max(8192).optional(),
  remoteName: z
    .string()
    .trim()
    .min(1)
    .max(256)
    // eslint-disable-next-line no-control-regex -- 远端名称不允许参数前缀、空白或控制字符。
    .regex(/^[^-\s\u0000-\u001f][^\s\u0000-\u001f]*$/)
    .optional(),
  accountId: z.string().uuid().optional(),
});
export type ForgeRepositoryRequest = z.infer<typeof forgeRepositoryRequestSchema>;
export const forgeTargetRequestSchema = forgeRepositoryRequestSchema.extend({
  repositoryKey: z.string().min(1).max(1024),
  accountId: z.string().uuid(),
});
export type ForgeTargetRequest = z.infer<typeof forgeTargetRequestSchema>;
export const forgeImageRequestSchema = forgeTargetRequestSchema.extend({
  url: z.string().min(1).max(8192).url(),
});
export type ForgeImageRequest = z.infer<typeof forgeImageRequestSchema>;
export const forgeImagePreviewSchema = z.object({
  mediaType: z.enum(["image/png", "image/jpeg", "image/gif", "image/webp", "image/avif"]),
  dataBase64: z
    .string()
    .min(1)
    .max(16 * 1024 * 1024)
    .regex(/^[A-Za-z0-9+/]*={0,2}$/),
  totalBytes: z
    .number()
    .int()
    .positive()
    .max(12 * 1024 * 1024),
});
export type ForgeImagePreview = z.infer<typeof forgeImagePreviewSchema>;
// 仅用于 Window Host 与 Main 的原生传输；不携带账号令牌或浏览器 Cookie。
export const forgeWebMediaContextSchema = z
  .object({
    accountId: z.string().uuid(),
    username: z.string().trim().min(1).max(256),
    serverUrl: z.string().url().max(8192),
    repository: z.string().min(1).max(4096),
    repositoryUrl: z.string().url().max(8192),
    url: z.string().url().max(8192),
    loginUrl: z.string().url().max(8192),
  })
  .strict();
export type ForgeWebMediaContext = z.infer<typeof forgeWebMediaContextSchema>;
export const hostForgeWebMediaRequestSchema = z.discriminatedUnion("action", [
  z
    .object({
      type: z.literal("forge-web-media-request"),
      requestId: z.string().uuid(),
      action: z.enum(["read", "authenticate"]),
      context: forgeWebMediaContextSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("forge-web-media-request"),
      requestId: z.string().uuid(),
      action: z.literal("cancel"),
    })
    .strict(),
]);
export const hostForgeWebMediaResultSchema = z
  .object({
    type: z.literal("forge-web-media-result"),
    requestId: z.string().uuid(),
    ok: z.boolean(),
    preview: forgeImagePreviewSchema.optional(),
    error: z
      .string()
      .regex(/^FORGE_[A-Z_]+$/)
      .optional(),
  })
  .strict();
export type HostForgeWebMediaRequest = z.infer<typeof hostForgeWebMediaRequestSchema>;
export type HostForgeWebMediaResult = z.infer<typeof hostForgeWebMediaResultSchema>;
export interface ForgeWebMediaPort {
  read(context: ForgeWebMediaContext): Promise<ForgeImagePreview>;
  authenticate(context: ForgeWebMediaContext): Promise<void>;
}
const pageSchema = z.number().int().min(1).max(100_000);
const pageSizeSchema = z.number().int().min(1).max(100);
export const forgeListRequestSchema = forgeTargetRequestSchema.extend({
  kind: z.enum(["issue", "pull-request"]),
  state: z.enum(["open", "closed", "all"]),
  search: z.string().trim().max(512).default(""),
  sort: z.enum(["newest", "oldest", "updated"]).default("newest"),
  labels: z.array(z.string().min(1).max(256)).max(20).default([]),
  page: pageSchema,
  pageSize: pageSizeSchema,
});
export type ForgeListRequest = z.input<typeof forgeListRequestSchema>;
export type ForgeListQuery = z.output<typeof forgeListRequestSchema>;
export const forgeItemRequestSchema = forgeTargetRequestSchema.extend({
  kind: z.enum(["issue", "pull-request"]),
  number: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
});
export type ForgeItemRequest = z.infer<typeof forgeItemRequestSchema>;
export const forgePageRequestSchema = forgeItemRequestSchema.extend({
  page: pageSchema,
  pageSize: pageSizeSchema,
});
export type ForgePageRequest = z.infer<typeof forgePageRequestSchema>;
export const forgeCommentRequestSchema = forgeItemRequestSchema.extend({
  body: z.string().trim().min(1).max(65_000),
});
export type ForgeCommentRequest = z.infer<typeof forgeCommentRequestSchema>;
export const forgeNewIssueRequestSchema = forgeTargetRequestSchema.extend({
  title: z.string().trim().min(1).max(256),
  body: z.string().max(65_000),
});
export type ForgeNewIssueRequest = z.infer<typeof forgeNewIssueRequestSchema>;
export const forgeStateRequestSchema = forgeItemRequestSchema.extend({
  state: z.enum(["open", "closed"]),
});
export type ForgeStateRequest = z.infer<typeof forgeStateRequestSchema>;
export const forgeMergeRequestSchema = forgeItemRequestSchema.extend({
  kind: z.literal("pull-request"),
  headSha: z.string().regex(/^[a-f\d]{40,64}$/i),
  method: z.enum(["merge", "squash", "rebase"]),
});
export type ForgeMergeRequest = z.infer<typeof forgeMergeRequestSchema>;

export interface ForgeRepository {
  key: string;
  name: string;
  url: string;
  provider: ForgeProvider;
  accountId: string;
  accountUsername: string;
}
export interface ForgeRepositoryInfo {
  status:
    | "ready"
    | "git-unavailable"
    | "not-repository"
    | "no-remote"
    | "unsupported"
    | "missing-account"
    | "account-mismatch";
  remoteNames: string[];
  remoteName: string | null;
  host: string | null;
  provider: ForgeProvider | null;
  repository: ForgeRepository | null;
}
export interface ForgeLabel {
  key: string;
  name: string;
  color: string | null;
}
export interface ForgeAuthor {
  username: string;
  avatarUrl: string | null;
  displayName?: string;
}
export interface ForgeItem {
  number: number;
  kind: ForgeItemKind;
  title: string;
  body: string;
  state: ForgeItemState;
  draft: boolean;
  author: ForgeAuthor;
  url: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  labels: ForgeLabel[];
  commentCount: number;
}
export interface ForgePage<T> {
  items: T[];
  page: number;
  pageSize: number;
  hasMore: boolean;
  total: number | null;
}
export interface ForgeItemList extends ForgePage<ForgeItem> {
  reachableTotal: number | null;
  incomplete: boolean;
}
export interface ForgeComment {
  id: string;
  body: string;
  author: ForgeAuthor;
  createdAt: string | null;
  url: string | null;
  system?: boolean;
  /** GitLab 标签资源事件不属于 notes；保留结构化内容，避免把标签名称当作 Markdown。 */
  labelActivity?: {
    action: "add" | "remove";
    /** 已删除的标签由平台返回 null，界面显示本地化占位。 */
    labels: Array<ForgeLabel | null>;
  };
}
export interface ForgeChangedFile {
  path: string;
  previousPath: string | null;
  status: "added" | "removed" | "modified" | "renamed";
  additions: number;
  deletions: number;
  patch: string | null;
  truncated: boolean;
}
export interface ForgeCheck {
  id: string;
  name: string;
  state: "success" | "failure" | "pending" | "neutral";
  url: string | null;
}
export interface ForgeChange {
  headSha: string;
  headBranch: string;
  baseBranch: string;
  mergeable: boolean | null;
  mergeMethods: ForgeMergeMethod[];
  mergeOptionsError: string | null;
  checks: ForgeCheck[];
  checksError: string | null;
}
export interface ForgeItemDetail extends ForgeItem {
  change: ForgeChange | null;
  metadata?: ForgeItemMetadata;
}

export interface ForgeItemMetadata {
  assignees: ForgeAuthor[];
  milestone: { title: string; url: string | null } | null;
  dueDate?: string | null;
  timeStats?: { estimateSeconds: number; spentSeconds: number } | null;
  confidential?: boolean | null;
  participants?: ForgeAuthor[];
  participantsHasMore?: boolean;
  taskStatus?: { total: number; completed: number };
  linkedItems?: Array<{ number: number; title: string; state: ForgeItemState; url: string | null }>;
  linkedItemsHasMore?: boolean;
  errors?: Partial<Record<"participants" | "links" | "labels", string>>;
}

export type ForgeItemExtras = Pick<
  ForgeItemMetadata,
  "participants" | "participantsHasMore" | "linkedItems" | "linkedItemsHasMore" | "errors"
> & { labels?: ForgeLabel[] };
