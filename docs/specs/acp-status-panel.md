# ACP conversation status panel

## Rules and owners

Populated ACP conversations reuse ConversationStatusPanel, its Git tools, mini/panel/
automatic modes and the timeline's coordinated layout. Empty ACP drafts retain their
existing greeting. Git visibility matches API: available repository with nonzero
worktree line changes, hidden in Office mode. No always-visible clean-repo card.

The workspace shell's existing Git hook owns repository reads/watch refresh. Same
workspace panes share its summary and actions; different workspace identity/path
panes must not consume shell Git facts or callbacks (existing Workbench boundary).
This change does not introduce a second repository state owner or a cross-workspace
Git review surface. Unavailable Git stays absent rather than inventing zero counts.

The selected ACP Host snapshot is the only source of ACP goal text, latest current
turn plan and workflow facts. Plan statuses project to the existing Todo model;
an empty plan clears the section and a new user turn clears the previous turn plan.
Goal is reported objective text only: do not fabricate verification, iterations,
duration or native pause/resume controls. API goal, plan documents, background Bash,
subagent directory, task change summaries and native workflow commands must never
leak into ACP. ACP workflow entries remain reported facts; existing timeline cards
retain ACP workflow actions. API retains its current behavior.

```text
workspace Git owner → scoped shell facts ──┐
ACP Host → persist revision ───────────────┼→ read-only pane projection → shared panel
  ├→ desktop-continuous notifications ────┤                         └→ same layout model
  └→ web-remote-replayable snapshots ─────┘                            for timeline/dock
```

Layout is derived from the same projected content as the panel. Switching Agent,
session or workspace replaces the facts; no UI transcript or persistent cache is
added. Existing local panel display preference is shared with API. Workspace
identity isolation and revision/stale callback guards stay unchanged.

## Acceptance

1. Real SessionPane with fake Host and dirty Git facts shows the existing right-hand
   panel and branch. Changes opens the existing scoped Git review callback; branch
   selection lists branches via the supplied workspace service. No real Git mutation.
2. Fake ACP plan updates, empty replacement, new user turn and goal updates appear
   from Host snapshots only. No API goal actions, task diffs or background state.
3. Mini → expanded → mini uses existing controls. Desktop wide layout reserves
   room consistently; narrow/mobile does not overflow. Check light/dark themes.
4. Clean/nonrepository/unavailable Git and Office mode keep existing API visibility
   rules. Different identities cannot reuse shell Git summary/callbacks.
5. Remount from replay snapshot and scoped session switch reproduce current facts,
   with no new ACP connection/prompt caused by panel interactions.
6. Execute projection regressions, actual pane E2E, typecheck, lint, architecture
   and changed-file formatting checks. Preserve earlier queue/thought changes.
