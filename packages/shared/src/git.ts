import type { Locale } from "./protocol.js";

export type GitHeadRefType = "branch" | "detached";

export type GitChangeKind = "modified" | "added" | "deleted" | "renamed";

export type GitChangeSourceId = "unstaged" | "staged" | "branch" | "last-turn";

export type GitRepositoryChangeSourceId = Extract<
  GitChangeSourceId,
  "unstaged" | "staged" | "branch"
>;

export type GitChangeSectionId =
  | "staged"
  | "unstaged"
  | "untracked"
  | "conflicted"
  | "branch"
  | "last-turn";

export type GitDiffAvailability = "patch" | "binary" | "truncated" | "unavailable";

export type GitBranchMutationAction = "switch" | "create-and-switch";

export type GitBranchMutationIssueCode =
  | "invalid-branch-name"
  | "branch-already-exists"
  | "target-branch-not-found"
  | "tracked-changes-would-be-overwritten"
  | "untracked-changes-would-be-overwritten"
  | "conflicts-present"
  | "operation-in-progress"
  | "branch-in-other-worktree"
  | "unknown";

export interface GitRepositorySummary {
  workspacePath: string;
  repoRoot: string;
  workspaceInRepoPath: string;
  /** Git 元数据 watcher 边界；workspace 内容 watcher 由 UI 按 workspace Host 平台决定。 */
  autoRefreshWatchPaths: GitRepositoryAutoRefreshWatchPath[];
  branchName: string | null;
  trackingBranchName: string | null;
  headRefType: GitHeadRefType;
  ahead: number;
  behind: number;
  isDirty: boolean;
  isGitAvailable: boolean;
  isRepository: boolean;
}

export interface GitRepositoryAutoRefreshWatchPath {
  path: string;
  recursive: boolean;
}

export interface GitFileChange {
  path: string;
  repoRelativePath: string;
  workspaceRelativePath: string;
  x?: string;
  y?: string;
  kind: GitChangeKind;
  section: GitChangeSectionId;
  added: number;
  removed: number;
  isStaged: boolean;
  isUntracked: boolean;
  isConflicted: boolean;
}

export interface GitDiffRequest {
  path: string;
  staged?: boolean;
  sourceId?: GitChangeSourceId;
}

export interface GitDiffResult {
  path: string;
  availability: GitDiffAvailability;
  patch: string | null;
  beforeContent: string | null;
  afterContent: string | null;
  summary?: string | null;
}

export interface GitIdentity {
  userName: string | null;
  userEmail: string | null;
  nameSource: string | null;
  emailSource: string | null;
  scopeLabel?: string | null;
}

export interface GitRepositoryRequest {
  workspacePath: string;
}

export type GitCommitGraphRefKind = "branch" | "remote" | "tag" | "head";

export interface GitCommitGraphRef {
  name: string;
  kind: GitCommitGraphRefKind;
}

export interface GitCommitGraphCommit {
  hash: string;
  parents: string[];
  refs: GitCommitGraphRef[];
  subject: string;
  authorName: string | null;
  authoredAtMs: number | null;
}

export interface GitCommitGraphRequest extends GitRepositoryRequest {
  maxCount?: number;
  skip?: number;
  /** Task worktree allocation pins the current HEAD, excluding unrelated branch tips. */
  headOnly?: boolean;
}

export interface GitCommitGraphResult {
  commits: GitCommitGraphCommit[];
  hasMore: boolean;
}

export interface GitRefreshRequest extends GitRepositoryRequest {
  includeIdentity?: boolean;
  includeBranchComparison?: boolean;
}

export type GitWorkspaceRepositoryKind = "not-repository" | "main-tree" | "linked-worktree";

export interface GitWorkspaceRepositoryInfo {
  workspacePath: string;
  kind: GitWorkspaceRepositoryKind;
  isGitAvailable: boolean;
  /** Git 解析的当前工作树根目录；不把 workspace 子目录当作仓库根。 */
  repoRoot?: string;
  /** 仅 linked worktree 返回 Git 注册的主工作树根目录。 */
  mainWorktreePath?: string;
  /** 仅 linked worktree 且 HEAD 指向分支时返回短分支名。 */
  branchName?: string;
}

export interface GitSwitchBranchRequest extends GitRepositoryRequest {
  targetBranchName: string;
}

export interface GitCreateBranchRequest extends GitRepositoryRequest {
  branchName: string;
  startPoint?: string;
}

export type GitWorktreeCreateIssueCode =
  | "name-allocation-failed"
  | "invalid-branch-name"
  | "branch-already-exists"
  | "target-branch-not-found"
  | "target-path-invalid"
  | "target-path-not-empty"
  | "operation-in-progress"
  | "branch-in-other-worktree"
  | "not-repository"
  | "command-timeout"
  | "unknown";

export interface GitCreateWorktreeRequest extends GitRepositoryRequest {
  branchName: string;
  worktreePath: string;
  startPoint?: string;
}

export interface GitResolveLocalBranchRequest extends GitRepositoryRequest {
  branchName: string;
}

export interface GitResolvedLocalBranch {
  branchName: string;
  commitHash: string;
}

export interface GitPrepareTaskMergeRequest extends GitRepositoryRequest {
  taskWorktreePath: string;
  taskBranchName: string;
  targetBranchName: string;
  worktreePath: string;
  branchName: string;
  commitMessage: string;
  expectedTargetCommit?: string;
}

export interface GitTaskMergePreparation {
  sourceCommit: string;
  targetCommit: string;
  conflicts: string[];
}

export interface GitFinalizeTaskMergeRequest
  extends GitPrepareTaskMergeRequest, GitTaskMergePreparation {}

export interface GitApplyTaskMergeRequest extends GitFinalizeTaskMergeRequest {
  resultCommit: string;
}

export interface GitCreateAutomaticWorktreeRequest extends GitRepositoryRequest {
  worktreeRootPath: string;
  /** 已解析的关联项目基准；缺省仍从当前 HEAD 创建。 */
  startPoint?: string;
  /** 指定本地来源分支；传入时优先于 startPoint。 */
  sourceBranchName?: string;
}

export interface GitWorktreeCreateIssue {
  code: GitWorktreeCreateIssueCode;
  message: string;
  detail?: string | null;
}

export interface GitCreateWorktreeResult {
  ok: boolean;
  branchName: string | null;
  worktreePath: string;
  didCreate: boolean;
  issues: GitWorktreeCreateIssue[];
}

export interface GitManagedWorktree {
  worktreePath: string;
  branchName: string | null;
}

export interface GitManagedWorktreeProject {
  projectPath: string;
  worktrees: GitManagedWorktree[];
}

export interface GitManagedWorktreeRootRequest {
  worktreeRootPath: string;
}

export interface GitRemoveManagedWorktreeRequest extends GitManagedWorktreeRootRequest {
  projectPath: string;
  worktreePath: string;
  /** Task cleanup must match the persisted allocation before removing a registered tree. */
  expectedBranchName?: string;
  /** Retry a completed removal; missing but still registered trees remain invalid. */
  allowMissing?: boolean;
}

export type GitManagedWorktreeRemovalIssue =
  | "invalid-target"
  | "dirty-worktree"
  | "locked-worktree"
  | "workspace-busy"
  | "operation-in-progress"
  | "command-failed";

export type GitRemoveManagedWorktreeResult =
  | { ok: true }
  | { ok: false; issue: GitManagedWorktreeRemovalIssue };

export interface GitChangesRequest extends GitRepositoryRequest {
  sourceId: Extract<GitRepositoryChangeSourceId, "unstaged" | "staged">;
}

export interface GitIgnoredPathsRequest extends GitRepositoryRequest {
  paths: string[];
}

export interface GitDiffQuery extends GitRepositoryRequest, GitDiffRequest {}

export interface GitBranchComparison {
  baseRef: string | null;
  headRef: string | null;
  comparisonLabel: string | null;
  changes: GitFileChange[];
}

export interface GitLocalBranch {
  name: string;
  isCurrent: boolean;
  /** Git 登记的检出目录；可选以兼容尚未升级的 Host。 */
  worktreePath?: string | null;
  upstreamName: string | null;
  commitHash: string | null;
  commitTimestampMs: number | null;
}

export interface GitLocalBranchListResult {
  headRefType: GitHeadRefType;
  currentBranchName: string | null;
  branches: GitLocalBranch[];
}

export interface GitBranchMutationIssue {
  code: GitBranchMutationIssueCode;
  message: string;
  paths?: string[];
  detail?: string | null;
}

export interface GitBranchMutationResult {
  ok: boolean;
  action: GitBranchMutationAction;
  branchName: string | null;
  didChange: boolean;
  created: boolean;
  summary: GitRepositorySummary;
  issues: GitBranchMutationIssue[];
}

export interface GitPathMutationRequest extends GitRepositoryRequest {
  paths: string[];
}

export interface GitDiscardPathsRequest extends GitPathMutationRequest {
  staged?: boolean;
}

export interface GitCommitRequest extends GitRepositoryRequest {
  message: string;
  paths?: string[];
  stagedOnly?: boolean;
}

export interface GitCommitResult {
  commitHash: string;
  summary: GitRepositorySummary;
}

export interface GitGenerateCommitMessageRequest extends GitRepositoryRequest {
  workspaceIdentity?: string;
  locale?: Locale;
  includeUnstaged?: boolean;
  currentSessionFilePaths?: string[];
  conversationContext?: GitCommitMessageConversationContext;
}

export interface GitCommitMessageConversationContext {
  sessionId?: string;
  omittedMessageCount?: number;
  messages: GitCommitMessageConversationMessage[];
}

export interface GitCommitMessageConversationMessage {
  role: "user" | "assistant";
  content: string;
}

export interface GitGenerateCommitMessageResult {
  message: string;
  providerId: string;
  model: string;
}

export interface GitPushRequest extends GitRepositoryRequest {}

export interface GitPushResult {
  branchName: string | null;
  trackingBranchName: string | null;
  remoteName: string | null;
  setUpstream: boolean;
  summary: GitRepositorySummary;
}

export interface GitRefreshResult {
  summary: GitRepositorySummary;
  identity: GitIdentity | null;
  unstagedChanges: GitFileChange[];
  stagedChanges: GitFileChange[];
  branchComparison: GitBranchComparison | null;
}

export type GitCheckpointScope = "workspace";

export type GitCheckpointConflictReason =
  | "content-mismatch"
  | "missing-in-worktree"
  | "unexpected-file-in-worktree"
  | "type-mismatch";

export interface GitCheckpointMeta {
  checkpointId: string;
  workspacePath: string;
  repoRoot: string;
  workspaceInRepoPath: string;
  createdAt: number;
  refName: string;
  commitOid: string;
  scope: GitCheckpointScope;
}

export interface GitCheckpointRequest extends GitRepositoryRequest {
  checkpointId: string;
}

export interface GitCheckpointDiffQuery extends GitRepositoryRequest {
  fromCheckpointId: string;
  toCheckpointId: string;
}

export interface GitCheckpointFileDiff {
  path: string;
  repoRelativePath: string;
  workspaceRelativePath: string;
  originalPath?: string | null;
  kind: GitChangeKind;
  added: number;
  removed: number;
}

export interface GitCheckpointDiff {
  fromCheckpointId: string;
  toCheckpointId: string;
  files: GitCheckpointFileDiff[];
}

export interface GitCheckpointRestoreQuery extends GitCheckpointDiffQuery {
  force?: boolean;
}

export interface GitCheckpointConflict {
  path: string;
  repoRelativePath: string;
  workspaceRelativePath: string;
  reason: GitCheckpointConflictReason;
}

export interface GitCheckpointRestoreResult {
  success: boolean;
  conflicts?: GitCheckpointConflict[];
  restoredPaths?: string[];
}
