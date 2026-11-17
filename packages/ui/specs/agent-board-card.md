# Agent Board Card

## Behavior

- Each Agent Board card presents one `BoardItem` in the active project or status group.
- The card presents project and status, title and summary, agent and result time, and any offline indicator.
- Opening the card continues to use `onOpen`.
- Cards do not render a bottom action row, workspace path, drag handle, or stage/unstage action.
- Existing staged state remains visible through the board's staged status and sidebar counts; this presentation change does not rewrite persisted staged items.
- Card styling responds to hover and keyboard focus and remains legible in the active light or dark theme.
- Long project labels, titles, summaries, agent names, and workspace paths do not force the card beyond its group width.

## Ownership and invariants

- `AgentBoardPanel` and `useAgentBoardData` continue to own the board projection and source updates.
- `AgentBoardGroups` continues to own grouping and placement; `AgentBoardCard` remains a presentation and command-dispatch component.
- Status, staged state, unread state, and offline state remain derived from the current `BoardItem`; the card adds no duplicate state or persistence path.
- Staged-item state remains owned by `agentBoardStore`; the card does not write staged state.

## Acceptance scenarios

- Cards retain project/status, title/summary, agent/time, unread, running, and offline indicators when applicable.
- Cards render no footer/action row at desktop or mobile widths.
- Existing staged items remain visible in staged board counts and status grouping.
- Hover and keyboard focus are visible without changing card actions or board state.
- Long localized content remains contained in desktop and narrow mobile group widths.
- Existing Agent Board interaction and layout E2E scenarios continue to pass in both light and dark themes.
