# Shared Trigger Ref Lifecycle

## Scope

Workspace context buttons and the API/ACP composer **+** menu retain their existing
tooltip, click, keyboard, disabled, focus and popup behavior. A shared trigger
must not crash `workspace-header` or `workspace-chat` with `Maximum update depth
exceeded` during mounting, rerendering or conversation changes.

This change owns only DOM ref composition. It does not change authentication,
Agent connection admission, conversation commands, task state, drafts or Git.

## Ownership And Rules

- React owns DOM attachment/detachment. Radix owns tooltip/popover anchor and
  open state. The header owns its controlled context tooltip; the composer owns
  its existing action menu. There is no new state owner or timer.
- A Radix Slot must reuse its composed callback while its forwarded ref and child
  ref are unchanged. Rendering new labels, pending state or conversation metadata
  must not detach/reattach the same DOM node.
- A Radix DropdownMenu trigger must likewise reuse the composition of its
  forwarded ref and context-owned trigger ref. Slot stability alone cannot protect
  a tooltip anchor when a nested DropdownMenu trigger recreates its own ref.
- Slot must keep its existing event, style, class, Slottable and Fragment semantics.
  Ref composition hooks must run unconditionally, including null children.
- `ControlHintTooltip` must forward object refs, ordinary callback refs and React
  19 callback-ref cleanup functions. Each registered ref is released exactly once
  by its cleanup, or by `ref(null)` when it has no cleanup.
- Use Radix's existing `useComposedRefs` for the Slot and DropdownMenu trigger
  patches, not a replacement tooltip/popover implementation. Register both
  version-scoped patches through pnpm so a fresh install and both ESM/CJS builds
  receive the same fix. Do not change dependency versions or public UI contracts.
- Existing error boundaries remain unchanged; failures are not hidden or retried
  automatically. Hover hints and the **+** menu remain available.

```text
React DOM commit
    -> stable Slot + DropdownMenu trigger refs
    -> Radix trigger/anchor state + caller ref
    -> derived tooltip/popover UI

same refs + same DOM + metadata rerender -> no extra ref registration
DOM replacement/unmount -> cleanup once -> next DOM attachment

Tooltip anchor state update -> nested DropdownMenu trigger rerender
    -> reuse existing composed ref -> no detach/attach -> no anchor state loop
```

## Acceptance

1. A controlled header-style tooltip and a tooltip/popover **+** trigger with a
   stateful caller ref mount without a nested-update failure.
2. Repeated label/mode updates retain the same trigger DOM and do not produce
   spurious ref-null/ref-node notifications. Real unmount releases it once.
3. React 19 cleanup refs under both plain and nested triggers execute their
   cleanup once. Object refs and callbacks without cleanup receive null.
4. Tooltip hover/focus, popover click/Enter/Escape, disabled controls and event
   composition continue to work. No nested buttons or extra layout wrapper is added.
5. Slot transitions between null/element/Fragment and Slottable retain hook order
   and continue to support child and forwarded refs.
6. The real ChatPromptEditor can switch between API, Codex ACP and Claude ACP,
   retain a typed draft, and open/close **+** for attachments, file references and
   supported ACP actions without sending a prompt or connecting an Agent.
7. Verify light/dark themes and 1280px/320px viewports, with no horizontal overflow
   or shifted fixed-size icon buttons. Run typecheck, lint and architecture checks.
8. A tooltip wrapping a DropdownMenu trigger mounts, changes labels, switches
   conversation identity and opens/closes without changing the trigger DOM or
   reporting a nested-update failure. Include ordinary, cleanup and object refs,
   disabled state, controlled open state, item selection and keyboard focus return.
9. Mount the real WorkspaceHelpMenuButton in the regression fixture. In the
   actual desktop app, open existing API and ACP conversations and exercise the
   header help menu, workspace tooltip, composer **+** and conversation status
   menu without sending messages or creating Agent connections.

## Evidence

The captured desktop stack passes through Radix `setRef`/`SlotClone`,
`ControlHintTooltip`, `WorkspaceHeaderTitleSection` and `ChatPromptActionMenu`.
Isolated initial mounts alone did not reproduce the reported crash. Regression
coverage must include ref-driven parent updates and the real editor, not only
synthetic conversation panels.

After rebuilding the optimizer and clearing the desktop HTTP cache, the executed
Slot code was confirmed patched, but opening a history conversation still crashed.
The new stacks point to WorkspaceHelpMenuButton and ConversationStatusPanel,
both nesting DropdownMenuTrigger inside ControlHintTooltip. The installed
DropdownMenu trigger still calls non-memoized `composeRefs` during render;
the regression must fail for this combination before applying its patch.
