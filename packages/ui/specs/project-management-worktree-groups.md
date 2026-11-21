# Project Management Worktree Groups

## Behavior

- Project management displays only the main worktree row for each local Git repository.
- Linked worktrees are omitted from this page, including when their main worktree is not open; they are not separate search results or removal targets here.
- The main project's workflow selection remains the editable workflow selection for the repository. Omitting linked worktrees from this settings projection does not remove their workspace entries or change their availability to boards and sessions.
- Remote workspaces and non-repository workspaces remain independent rows.
- Search and select-results operate only on displayed main projects and independent remote/non-repository workspaces.

## Ownership and invariants

- `useProjectManagement` owns the workspace entries and removal operation.
- `useWorktreeProjectGroups` derives Git relationships; this page filters linked worktrees from its display and selection projection without changing workspace identity, paths, workflow persistence, or deletion semantics.
- Workflow configuration continues to be read and written through the existing task workflow service.
- Git relationship resolution determines which local entries are main worktrees and which are linked worktrees. This page does not expose linked worktrees as independent projects.

## Acceptance scenarios

- A main worktree and multiple open linked worktrees render as one main project row with a workflow selector; no linked-worktree child rows render.
- Selecting all results and searching select only visible main projects and independent remote/non-repository workspaces; linked worktree paths do not yield rows.
- Removing the displayed main project uses only that main project's existing workspace entry and does not cascade into linked worktree entries.
- An unopened parent does not cause its linked worktree to appear as a project row; remote workspaces and unrelated same-name repositories remain independent.
- The project list remains usable at mobile width and long paths remain truncated without losing their full value to accessible text.
