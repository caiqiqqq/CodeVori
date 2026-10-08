import type { WorkspaceTabState } from "@/store/tabStore.js";
import type { WorktreeProjectGroup } from "@/lib/worktreeProjectGrouping.js";
import { getPathLeaf } from "@/lib/path.js";
import {
  buildWorkspaceSessionKey,
  formatRemoteWorkspaceTargetSubtitle,
  hasRemoteWorkspaceIdentity,
} from "@/lib/remoteWorkspaceHistory.js";

export type RepositoryWorkspaceTab = Pick<
  WorkspaceTabState,
  | "workspacePath"
  | "workspaceIdentity"
  | "label"
  | "remoteSessionId"
  | "remoteTarget"
  | "workspacePurpose"
  | "availability"
>;

interface RepositoryWorkspaceOption extends RepositoryWorkspaceTab {
  key: string;
  remoteSubtitle: string;
  disabledReason: "unavailable" | "disconnected" | null;
}

const EMPTY_CONNECTED_SESSIONS: ReadonlySet<string> = new Set();

export function getRepositoryWorkspaceOptions(
  groups: readonly WorktreeProjectGroup[],
  connectedSessionIds: ReadonlySet<string> = EMPTY_CONNECTED_SESSIONS,
): RepositoryWorkspaceOption[] {
  const seen = new Set<string>();
  return groups.flatMap(({ tab, isLinkedWorktree }) => {
    const key = buildWorkspaceSessionKey(tab);
    if (isLinkedWorktree || tab.workspacePurpose === "conversation" || seen.has(key)) return [];
    seen.add(key);
    const disconnected =
      hasRemoteWorkspaceIdentity(tab) &&
      (!tab.remoteSessionId || !connectedSessionIds.has(tab.remoteSessionId));
    return [
      {
        ...tab,
        key,
        label: tab.label.trim() || getPathLeaf(tab.workspacePath),
        remoteSubtitle: tab.remoteTarget
          ? formatRemoteWorkspaceTargetSubtitle(tab.remoteTarget)
          : "",
        disabledReason:
          tab.availability === "unavailable-local-directory"
            ? ("unavailable" as const)
            : disconnected
              ? ("disconnected" as const)
              : null,
      },
    ];
  });
}
