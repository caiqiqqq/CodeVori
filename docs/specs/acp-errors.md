# ACP conversation errors

## Contract and product rules

The existing ACP Host session owns failures attached to the admitted user entry.
Negotiate the installed Codex adapter's versioned `jetbrains.air.sessionFailure`
extension through client capability metadata. Parse both `session_info_update`
metadata and terminal prompt-response metadata. Do not infer failures by matching
assistant text; unsupported Agents retain normal ACP exception handling.

Validate and bound IDs, revisions, severity, categories, titles, details and
advertised actions. One incident ID replaces only an older revision in the same
command; a confirmed error cannot downgrade to a warning. Preserve up to 64 notices
per turn, preferentially evicting warnings. Duplicate notification/response facts
do not duplicate notices. Ordinary prompt/transport exceptions use this same Host
path, retaining readable error data without logging the payload.

Warnings remain notices and do not fail the prompt or pause the queue. A terminal
error fails the admitted turn even when ACP returns `stopReason: end_turn`: preserve
partial output, pause queued input, and do not automatically retry. Successful later
turns cannot overwrite earlier errors. Existing `traceError` and session error strings
remain compatibility projections; old snapshots without structured fields load.
`errorCommandId` scopes the current error to an accepted command or an internal
operation. Clearing the current error clears its scope. Missing scope in old
snapshots retains the existing last-turn fallback.
Unaccepted connection/validation errors remain operation errors without a user row.
Internal workflow-result prompts have no user entry: their failures remain scoped
session operation errors, hold notifications for a later explicit input, and never
attribute an error to an unrelated user turn or automatically resend the operation.

## Owner and delivery order

```mermaid
sequenceDiagram
  participant A as ACP Agent
  participant S as stdio adapter
  participant H as ACP Host owner
  participant U as Desktop / mobile timeline
  A->>S: session_info_update or prompt result / exception
  S->>S: validate native session + extension metadata
  S->>H: normalized failure (no assistant text)
  H->>H: generation / active command / deletion guards
  H->>H: upsert original user entry; persist revision
  H->>U: desktop continuous snapshot
  U->>H: mobile replayable snapshot on reconnect
  A->>S: prompt ends
  S->>H: result
  H->>H: error => interrupted + pause queue; warning => normal completion
```

Ignore initialization/load transcript replay, mismatched native sessions and stale
connections/runs. Response processing must use the same update callback, not a second
failure store on the connection. Errors do not fabricate Token or provider facts.

## Presentation

Project each turn's saved notices onto an optional shared turn-header notice field.
Render them after that turn's content, outside the work-history fold, using the API
`ChatErrorBanner` (details, copy). ACP operation/home errors reuse that
component; remove duplicate footer errors already represented by the turn. Only
existing supported operation actions are exposed; Agent action hints do not imply
ZCode implements login, native retry or new-session recovery. Dismissal only changes
the local operation overlay, never erases saved failures. No auto retry.
Legacy `traceError` projects to a neutral error notice. Failed turns and partial
assistant rows retain failed state after subsequent prompts and replay.

Warnings are temporary presentation, not terminal errors. Only the current running
turn projects warning banners; each warning is visible for five seconds and does
not reappear on unrelated renders. A changed warning title/severity is a new
presentation. Completed, interrupted and historical turns retain saved diagnostics
but do not replay warning banners. Confirmed errors remain visible with details and
copy actions. Remove error-specific report-issue actions, feedback drafts and their
unused translations from both banners and subscription error panels; the general
feedback center remains a separate feature.

The ACP Host remains the sole owner of accepted progress and saved diagnostics.
The warning component owns only local visibility: capture the turn's accepted
assistant/tool/plan/compaction content when a warning appears, then hide it as soon
as that content changes or the turn stops running. Header/notice revisions and
unrelated renders are not progress. Preserve all saved failure revisions so stale
notifications cannot resurrect a resolved incident at the Host. No timers decide
whether a connection has recovered; the UI timer only expires a warning's display.
No protocol/schema or owner/lease changes are needed. Desktop continuous updates
and mobile replayable snapshots project the same Host state; historical warnings
are not shown on either path.

```mermaid
sequenceDiagram
  participant A as ACP Agent
  participant H as Existing ACP Host owner
  participant U as Desktop/mobile timeline
  A->>H: scoped connection warning
  H->>U: saved warning in running-turn snapshot
  U->>U: show warning for up to five seconds
  A->>H: accepted live progress for same command/generation
  H->>U: accepted progress in continuous update / replayable snapshot
  U->>U: hide warning on changed turn content; retain confirmed failures
  H->>U: turn ends; warning banners no longer projected
```

Copying full error details shows success or clipboard failure feedback at the
horizontal and vertical center of the originating session pane, for both API and
ACP banners. Capture the pane before the asynchronous clipboard write; changing
focus must not move feedback into another pane. The existing Toast container owns
the transient result and its three-second dismissal. Follow pane resizing and
scrolling, constrain long feedback to its width, and allow clicks outside the
message. Standalone banners without a session pane use viewport center. A removed
pane hides its feedback instead of moving it over another conversation. Other
Toast positions and error-copy payloads retain their existing behavior.

```mermaid
sequenceDiagram
  participant B as Originating error banner
  participant C as Clipboard
  participant T as Existing Toast owner
  B->>B: capture containing session pane
  B->>C: write full error details
  C-->>B: success or failure
  B->>T: transient result + originating pane
  T->>T: center within pane; dismiss after three seconds
```

## Acceptance

1. Fake stdio verifies capability negotiation, scoped live notifications and
   terminal metadata, warning/error revisions, malformed metadata rejection,
   replay/session mismatch exclusion and readable RPC error details.
2. Host tests cover end_turn + error => failure, warning => completion, no queue
   drain on errors, notification/response deduplication, late/stale/deleted updates,
   restart and preservation across a successful later turn.
3. Projection and actual shared-timeline E2E cover failed status, per-turn notice
   position, details/copy, replay without duplicates, desktop/mobile and themes;
   connection errors use the same banner and permission UI remains functional.
4. Run focused regressions, typecheck, lint, architecture and formatting checks.
5. Error-copy feedback is centered in its originating pane on desktop split views
   and mobile, in both themes; resizing follows the pane, focus changes do not
   retarget it, clipboard failure uses the same position, and it auto-dismisses.
6. Ordinary warnings auto-dismiss after five seconds without repeat on unrelated
   renders; live recovery, turn completion and replay do not leave reconnect
   warnings visible. Confirmed errors survive recovery and later successful turns.
7. Error and subscription panels have no report-issue button or feedback draft path;
   copy/details and supported reconnect/dismiss actions continue working.
