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
`ChatErrorBanner` (details, copy, feedback). ACP operation/home errors reuse that
component; remove duplicate footer errors already represented by the turn. Only
existing supported operation actions are exposed; Agent action hints do not imply
ZCode implements login, native retry or new-session recovery. Dismissal only changes
the local operation overlay, never erases saved failures. No auto retry.
Legacy `traceError` projects to a neutral error notice. Failed turns and partial
assistant rows retain failed state after subsequent prompts and replay.

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
