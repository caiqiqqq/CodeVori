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
}
