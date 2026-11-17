# Agent Board Card

## Behavior

- Each Agent Board card presents one `BoardItem` in the active project or status group.
- The card preserves the existing content order: project and status, title and summary, agent and result time, then any offline or staging details.
- Opening the card continues to use `onOpen`; staging continues to use the existing drag and `onStage` actions.
- Card styling responds to hover and keyboard focus and remains legible in the active light or dark theme.
- Long project labels, titles, summaries, agent names, and workspace paths do not force the card beyond its group width.

## Ownership and invariants

- `AgentBoardPanel` and `useAgentBoardData` continue to own the board projection and source updates.
- `AgentBoardGroups` continues to own grouping and placement; `AgentBoardCard` remains a presentation and command-dispatch component.
- Status, staged state, unread state, and offline state remain derived from the current `BoardItem`; the card adds no duplicate state or persistence path.
- Drag admission and staging continue through the existing dnd-kit contract and `onStage` callback.

## Acceptance scenarios

- Cards retain project/status, title/summary, agent/time, unread, running, offline, and staging indicators when applicable.
- Hover and keyboard focus are visible without changing card actions or board state.
- Long localized content remains contained in desktop and narrow mobile group widths.
- Existing Agent Board interaction and layout E2E scenarios continue to pass in both light and dark themes.
