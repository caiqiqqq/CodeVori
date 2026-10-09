import type { GitChangeSourceId } from "@zcode/shared";
import type { GitPaneRepositoryState } from "@/hooks/useGitRepository.js";

export function getGitWorktreeStatus(datasets: GitPaneRepositoryState["datasets"]) {
  const sum = (source: "unstaged" | "staged") =>
    datasets[source].sections.reduce(
      (total, section) => {
        for (const change of section.changes) {
          total.added += change.added;
          total.removed += change.removed;
        }
        return total;
      },
      { added: 0, removed: 0 },
    );
  const unstaged = sum("unstaged");
  const staged = sum("staged");
  const reviewSourceId: GitChangeSourceId | null =
    unstaged.added + unstaged.removed > 0
      ? "unstaged"
      : staged.added + staged.removed > 0
        ? "staged"
        : null;
  return {
    changeSummary: {
      added: unstaged.added + staged.added,
      removed: unstaged.removed + staged.removed,
    },
    reviewSourceId,
  };
}
