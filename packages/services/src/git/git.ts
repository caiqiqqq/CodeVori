import type {
  GitBranchMutationResult,
  GitBranchComparison,
  GitCommitGraphRequest,
  GitCommitGraphResult,
  GitCreateBranchRequest,
  GitCreateWorktreeRequest,
  GitCreateAutomaticWorktreeRequest,
  GitCreateWorktreeResult,
  GitChangesRequest,
  GitCommitRequest,
  GitCommitResult,
  GitDiffQuery,
  GitDiffResult,
  GitDiscardPathsRequest,
  GitGenerateCommitMessageRequest,
  GitGenerateCommitMessageResult,
  GitIdentity,
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
} from "@zcode/shared";
import { ServiceChannels } from "@zcode/shared";
import { createServiceDescriptor } from "../descriptors.js";

export interface IGitService {
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
  getCommitGraph(params: GitCommitGraphRequest): Promise<GitCommitGraphResult>;
  switchBranch(params: GitSwitchBranchRequest): Promise<GitBranchMutationResult>;
  createBranchAndSwitch(params: GitCreateBranchRequest): Promise<GitBranchMutationResult>;
  createWorktree(params: GitCreateWorktreeRequest): Promise<GitCreateWorktreeResult>;
  createAutomaticWorktree(
    params: GitCreateAutomaticWorktreeRequest,
  ): Promise<GitCreateWorktreeResult>;
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
