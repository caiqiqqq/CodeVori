# Agent Board Workflow Status Library

## Behavior

- The status library defines Agent Board statuses in four lifecycle groups: unstarted, started, done, and closed.
- Enabled statuses appear as board columns, ordered first by lifecycle group and then by their saved order within that group. Renaming, enabling, disabling, adding, removing, or reordering statuses changes this presentation and board assignment vocabulary.
- Custom statuses belong to one lifecycle group, selected when they are created. Existing saved statuses without a group migrate to their built-in group's value, or `started` for older custom statuses.
- Assigning a card to a different status clears that card's board assignee. Runtime state such as running, waiting, or completed remains owned by the conversation or task and is not changed by board status.
- Status definitions and per-card assignments remain owned and persisted by `agentBoardStore`; the settings dialog edits a local draft until Save.
- The explanatory copy must distinguish board workflow statuses from runtime state and say what enabled statuses control.

## Ownership and invariants

- `agentBoardStore` is the only owner of accepted status definitions, assignments, assignees, and their local persistence.
- `AgentBoardWorkflowSettings` owns only the unsaved dialog draft and commits it through `setWorkflowStatuses`.
- The persisted status schema adds a lifecycle group. Hydration migrates older built-in statuses to their corresponding group and older custom statuses to `started`; invalid explicit groups invalidate the saved status set.
- Status grouping changes only the board's organization and ordering. It does not change conversation/task runtime state or status transition ownership.

## Acceptance scenarios

- Opening the status settings shows all four lifecycle groups and identifies enabled statuses as board columns for conversations and tasks.
- Custom statuses can be created in a selected lifecycle group, reordered within that group, and persist with the group selection.
- The explanation says enabled statuses become columns and clarifies that runtime state remains separate.
- Changing a card's workflow status continues to clear only its board assignee and does not alter its conversation/task runtime status.
- Settings remain readable in Chinese and English and keep the existing responsive dialog layout.
