import {
  boardDisplayStatus,
  isBoardItemStaged,
  matchesBoardTracking,
  type BoardDisplayStatus,
  type BoardItem,
  type BoardStagedItems,
  type BoardTracking,
} from "./agentBoardModel.js";

export type BoardSidebarCounts = Record<BoardDisplayStatus, number>;
export const emptyBoardSidebarCounts = (): BoardSidebarCounts => ({
  running: 0,
  completed: 0,
  staged: 0,
  error: 0,
});

export function countBoardSidebarItems(
  items: readonly BoardItem[],
  tracking: BoardTracking,
  stagedItems: BoardStagedItems,
) {
  const all = emptyBoardSidebarCounts();
  const standalone = emptyBoardSidebarCounts();
  const projects = new Map<string, BoardSidebarCounts>();
  for (const item of items) {
    if (item.archived || !matchesBoardTracking(item, tracking)) continue;
    const status = boardDisplayStatus({ ...item, staged: isBoardItemStaged(item, stagedItems) });
    all[status]++;
    if (item.workspacePurpose === "conversation") standalone[status]++;
    const project = projects.get(item.projectKey) ?? emptyBoardSidebarCounts();
    project[status]++;
    projects.set(item.projectKey, project);
  }
  return { all, standalone, projects };
}
