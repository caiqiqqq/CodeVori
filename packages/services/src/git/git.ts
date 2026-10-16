import type {
  GitTaskChangeRecordRequest,
  GitTaskChangeRecordResult,
  ForgeImageUploadRequest,
  ForgeImageUploadResult,
  ForgeImageUploadCapability,
  GitBranchMutationResult,
  GitBranchComparison,
  GitCommitGraphRequest,
  GitCommitGraphResult,
  GitCreateBranchRequest,
  GitCreateWorktreeRequest,
  GitCreateAutomaticWorktreeRequest,
  GitCreateWorktreeResult,
  GitManagedWorktreeProject,
  GitManagedWorktreeRootRequest,
  GitRemoveManagedWorktreeRequest,
  GitRemoveManagedWorktreeResult,
  GitChangesRequest,
  GitCommitRequest,
  GitCommitResult,
  GitDiffQuery,
  GitDiffResult,
  GitDiscardPathsRequest,
  GitGenerateCommitMessageRequest,
  GitGenerateCommitMessageResult,
  GitIdentity,
  GitResolveLocalBranchRequest,
  GitResolvedLocalBranch,
  GitPrepareTaskMergeRequest,
  GitTaskMergePreparation,
  GitFinalizeTaskMergeRequest,
  GitApplyTaskMergeRequest,
  GitIgnoredPathsRequest,
  GitLocalBranchListResult,
  GitPathMutationRequest,
  GitPushRequest,
  GitPushResult,
  GitRefreshRequest,
  GitRefreshResult,
  GitRepositoryRequest,
  GitRepositorySummary,
  GitWorkspaceRepositoryInfo,
  GitFileChange,
  GitSwitchBranchRequest,
  GitVersionControlSettings,
  GitDetection,
  GitPathRequest,
  GitAccountAddRequest,
  GitAccountRotateRequest,
  GitAccountIdRequest,
  GitAccountTestResult,
  ForgeRepositoryRequest,
  ForgeRepositoryInfo,
  ForgeListRequest,
  ForgeItemList,
  ForgeItemRequest,
  ForgeItemDetail,
  ForgeItemExtras,
  ForgePageRequest,
  ForgePage,
  ForgeComment,
  ForgeChangedFile,
  ForgeTargetRequest,
  ForgeLabel,
  ForgeNewIssueRequest,
  ForgeUpdateIssueRequest,
  ForgeItem,
  ForgeCommentRequest,
  ForgeStateRequest,
  ForgeMergeRequest,
  ForgeImageRequest,
  ForgeImagePreview,
  ForgeIssueOptions,
} from "@zcode/shared";
import { ServiceChannels } from "@zcode/shared";
import { createServiceDescriptor } from "../descriptors.js";

export interface IGitService {
  getTaskChangeRecord(input: GitTaskChangeRecordRequest): Promise<GitTaskChangeRecordResult>;
  getForgeImageUploadCapability(params: ForgeTargetRequest): Promise<ForgeImageUploadCapability>;
  uploadForgeImage(params: ForgeImageUploadRequest): Promise<ForgeImageUploadResult>;
  getForgeRepository(params: ForgeRepositoryRequest): Promise<ForgeRepositoryInfo>;
  listForgeItems(params: ForgeListRequest): Promise<ForgeItemList>;
  getForgeItem(params: ForgeItemRequest): Promise<ForgeItemDetail>;
  getForgeItemExtras(params: ForgeItemRequest): Promise<ForgeItemExtras>;
  readForgeImage(params: ForgeImageRequest): Promise<ForgeImagePreview>;
  authenticateForgeImage(params: ForgeImageRequest): Promise<void>;
  listForgeComments(params: ForgePageRequest): Promise<ForgePage<ForgeComment>>;
  listForgeFiles(params: ForgePageRequest): Promise<ForgePage<ForgeChangedFile>>;
  listForgeLabels(params: ForgeTargetRequest): Promise<ForgeLabel[]>;
  getForgeIssueOptions(params: ForgeTargetRequest): Promise<ForgeIssueOptions>;
  createForgeIssue(params: ForgeNewIssueRequest): Promise<ForgeItem>;
  updateForgeIssue(params: ForgeUpdateIssueRequest): Promise<ForgeItem>;
  createForgeComment(params: ForgeCommentRequest): Promise<void>;
  setForgeItemState(params: ForgeStateRequest): Promise<void>;
  mergeForgePullRequest(params: ForgeMergeRequest): Promise<void>;
  getVersionControlSettings(): Promise<GitVersionControlSettings>;
  detectGit(): Promise<GitDetection>;
  updateGitPath(params: GitPathRequest): Promise<GitDetection>;
  addGitAccount(params: GitAccountAddRequest): Promise<GitVersionControlSettings>;
  rotateGitAccount(params: GitAccountRotateRequest): Promise<GitVersionControlSettings>;
  testGitAccount(params: GitAccountIdRequest): Promise<GitAccountTestResult>;
  setDefaultGitAccount(params: GitAccountIdRequest): Promise<GitVersionControlSettings>;
  removeGitAccount(params: GitAccountIdRequest): Promise<GitVersionControlSettings>;
  getRepositorySummary(params: GitRepositoryRequest): Promise<GitRepositorySummary>;
  getWorkspaceRepositoryInfo(params: GitRepositoryRequest): Promise<GitWorkspaceRepositoryInfo>;
  getLocalBranches(params: GitRepositoryRequest): Promise<GitLocalBranchListResult>;
  resolveLocalBranch(params: GitResolveLocalBranchRequest): Promise<GitResolvedLocalBranch>;
  prepareTaskMerge(params: GitPrepareTaskMergeRequest): Promise<GitTaskMergePreparation>;
  finalizeTaskMerge(params: GitFinalizeTaskMergeRequest): Promise<{ commitHash: string }>;
  applyTaskMerge(params: GitApplyTaskMergeRequest): Promise<void>;
  getCommitGraph(params: GitCommitGraphRequest): Promise<GitCommitGraphResult>;
  switchBranch(params: GitSwitchBranchRequest): Promise<GitBranchMutationResult>;
  createBranchAndSwitch(params: GitCreateBranchRequest): Promise<GitBranchMutationResult>;
  createWorktree(params: GitCreateWorktreeRequest): Promise<GitCreateWorktreeResult>;
  createAutomaticWorktree(
    params: GitCreateAutomaticWorktreeRequest,
  ): Promise<GitCreateWorktreeResult>;
  listManagedWorktrees(params: GitManagedWorktreeRootRequest): Promise<GitManagedWorktreeProject[]>;
  removeManagedWorktree(
    params: GitRemoveManagedWorktreeRequest,
  ): Promise<GitRemoveManagedWorktreeResult>;
  getChanges(params: GitChangesRequest): Promise<GitFileChange[]>;
  getIgnoredPaths(params: GitIgnoredPathsRequest): Promise<string[]>;
  getDiff(params: GitDiffQuery): Promise<GitDiffResult>;
  getBranchComparison(params: GitRepositoryRequest): Promise<GitBranchComparison>;
  stagePaths(params: GitPathMutationRequest): Promise<void>;
  unstagePaths(params: GitPathMutationRequest): Promise<void>;
  discardPaths(params: GitDiscardPathsRequest): Promise<void>;
  generateCommitMessage(
    params: GitGenerateCommitMessageRequest,
  ): Promise<GitGenerateCommitMessageResult>;
  commit(params: GitCommitRequest): Promise<GitCommitResult>;
  push(params: GitPushRequest): Promise<GitPushResult>;
  getIdentity(params: GitRepositoryRequest): Promise<GitIdentity>;
  refresh(params: GitRefreshRequest): Promise<GitRefreshResult>;
}

export const IGitService = createServiceDescriptor<IGitService>(ServiceChannels.Git);
