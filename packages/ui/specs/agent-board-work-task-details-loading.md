# Agent Board Work Task Details Loading

## Behavior

Selecting a work-task card opens its details panel immediately, including while the details module is being loaded. The temporary panel shows the selected task title, a loading status, and a close action. Once the module loads, the normal details panel replaces the temporary content without changing the selected task.

Conversation session loading remains owned by `WorkTaskConversationPane` and keeps its existing loading status after the details module mounts. Module-load fallback and session-load feedback are separate phases.

## State and boundaries

- `AgentBoardPanel` owns the selected item; the fallback does not add or persist selection state.
- `AgentBoardDetails` owns presentation of the selected item and its lazy-module fallback.
- The fallback is visible only while the selected work-task details module is suspended. It does not represent task or session data readiness.
- Closing the fallback calls the existing `onClose` selection command.
- The change stays within the UI module and does not change service, protocol, persistence, or migration contracts.

## Acceptance scenarios

1. When the work-task details module request is held, selecting a task displays a details dialog with that task's title and an accessible loading status.
2. Releasing the module request replaces the fallback with the normal task conversation details.
3. The existing conversation session loading status remains available after the details module has loaded.
