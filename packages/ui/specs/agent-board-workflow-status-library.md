# Agent Board Workflow Status Library

## Behavior

- The status library defines the ordered set of workflow columns used to organize Agent Board conversations and tasks.
- Enabled statuses appear as board columns in the configured order. Renaming, enabling, disabling, adding, removing, or reordering statuses changes this presentation and board assignment vocabulary.
- Assigning a card to a different status clears that card's board assignee. Runtime state such as running, waiting, or completed remains owned by the conversation or task and is not changed by board status.
- Status definitions and per-card assignments remain owned and persisted by `agentBoardStore`; the settings dialog edits a local draft until Save.
- The explanatory copy must distinguish board workflow statuses from runtime state and say what enabled statuses control.

## Ownership and invariants

- `agentBoardStore` is the only owner of accepted status definitions, assignments, assignees, and their local persistence.
- `AgentBoardWorkflowSettings` owns only the unsaved dialog draft and commits it through `setWorkflowStatuses`.
- This presentation clarification does not change status transition behavior, persistence format, or conversation/task runtime state.

## Acceptance scenarios

- Opening the status settings identifies the library as the ordered set of board columns for conversations and tasks.
- The explanation says enabled statuses become columns and clarifies that runtime state remains separate.
- Changing a card's workflow status continues to clear only its board assignee and does not alter its conversation/task runtime status.
- Settings remain readable in Chinese and English and keep the existing responsive dialog layout.
