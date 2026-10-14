import type { GitRepositorySummary } from "@zcode/shared";

export function resolveConversationStatusBranchLabel(options: {
  gitSummary?: GitRepositorySummary | null;
  gitLoading?: boolean;
  loadingLabel: string;
  unavailableLabel: string;
  notRepositoryLabel: string;
  detachedLabel: string;
  unknownLabel: string;
}): string {
  const { gitSummary } = options;
  if (options.gitLoading || !gitSummary) {
    return options.loadingLabel;
  }

  if (!gitSummary.isGitAvailable) {
    return options.unavailableLabel;
  }

  if (!gitSummary.isRepository) {
    return options.notRepositoryLabel;
  }

  if (gitSummary.headRefType === "detached") {
    return options.detachedLabel;
  }

  return gitSummary.branchName?.trim() || options.unknownLabel;
}
