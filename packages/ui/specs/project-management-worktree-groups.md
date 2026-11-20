# Project Management Worktree Groups

## Behavior

- Project management displays one primary row for each Git repository whose main worktree is open.
- Open linked worktrees appear beneath that row as subordinate paths instead of duplicate top-level projects.
- The main project's workflow selection is the only editable workflow selection for the repository; linked worktrees continue to inherit it.
- Main worktrees and linked worktrees remain independently selectable for project removal. Removing a row affects only its own workspace entry.
- Worktrees whose main worktree is not open, remote workspaces, and non-repository workspaces remain independent rows.
- Search matches both the primary project and its linked worktree paths.

## Ownership and invariants

- `useProjectManagement` owns the workspace entries and removal operation.
- `useWorktreeProjectGroups` derives visual Git relationships; it does not change workspace identity, paths, workflow persistence, or deletion semantics.
- Workflow configuration continues to be read and written through the existing task workflow service.
- Until local Git relationships resolve, project entries remain visible as independent rows; confirmed grouping may then replace the flat projection.

## Acceptance scenarios

- A main worktree and multiple open linked worktrees render under one project heading, with a workflow selector only on the main row.
- Each entry remains independently selectable for removal.
- Searching for a linked worktree path reveals its parent project group.
- An unopened parent, remote workspace, and unrelated same-name repository are not incorrectly grouped.
- The project list remains usable at mobile width and long paths remain truncated without losing their full value to accessible text.
