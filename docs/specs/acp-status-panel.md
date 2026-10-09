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
duration or native pause/resume controls. API goal, plan documents, API background Bash,
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

## ACP commands and terminals

The shared Terminals section also shows selected-session ACP commands. Only current
turn `execute` tools explicitly reported `in_progress` appear; pending/unknown,
completed/failed, previous turns and interrupted/idle turns do not. These are
Agent-reported tool facts, not proof that a detached service is still alive. Opening
a row shows the same bounded input/output facts as its timeline tool. No per-tool
Stop is offered without an actual control capability.

For Agents using standard ACP `terminal/create`, the connection owns the real
process and implements output, wait-for-exit, kill and release. Arguments are passed
as argv without a shell; cwd defaults to the target workspace, environment extends
the adapter launch environment. The Host persists bounded terminal output and
running/finished/interrupted facts in that session's snapshot. Running terminals
remain visible after prompt completion until exit, kill, release or disconnect.
Do not infer PID, URL or lifetime from tool title/text. Linked terminal tool entries
are not duplicated in the panel.

Stop targets an exact session and opaque terminal ID through IAcpService; it never
reconnects an Agent or cancels a different turn. Unknown or cross-workspace targets
are rejected. Connection disposal/Agent exit releases owned process trees; a Host
restart marks persisted running terminals interrupted and never resumes a PID.
Older snapshots default to an empty terminal list. API runtime state is unchanged.

```text
Agent terminal/create → connection process owner → ACP Host revisioned snapshot
                      ├→ output / exit / kill / release → same snapshot
                      └→ disconnect → process-tree cleanup
desktop-continuous live updates ─┐
web-remote-replayable snapshots ─┴→ selected pane → Terminals → output / exact Stop
```

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
7. Execute tools enter/leave the panel on explicit lifecycle reports, including
   partial updates, idle/interrupted turns, new turns and session switches. Opening
   their output must not call native API commands or reconnect the ACP Agent.
8. Real stdio fixture creates a process, reads bounded output, waits, kills and
   releases it. Wrong native sessions are rejected. Prompt completion retains a
   running terminal; disconnect cleans it. Persist/replay preserves output and Host
   restart clears stale running state. Desktop/mobile output and Stop use exact ACP
   identity and terminal IDs and update via the same Host snapshot subscription.
