# ACP thoughts and plans

## Behavior and ownership

The existing target Host ACP session owns the displayed transcript. Accept live text
`agent_thought_chunk` as distinct thought entries and stable `plan` notifications as
plan entries, alongside existing assistant text and tool entries. Do not infer
thoughts from tool names or fabricate content when an Agent does not report it.
Non-text assistant content and unstable multi-plan extensions are outside this change.

Thoughts project to the existing V4 reasoning row and use the API conversation's
folding, streaming summary and visibility rules. Plans use a dedicated presentation
row, sharing the existing Todo step visuals and Todo visibility setting; they are not fabricated tool calls.
The latest full plan replaces the same turn's plan in place, including an empty list.
Preserve step content, priority and status exactly; turn completion never completes
unfinished plan steps. No execution action is exposed by the plan presentation.

## Event order and recovery

```text
Agent session/update → stdio adapter → existing scoped Host run guard
                                      → ordered entry mutation → persist revision
                                        ├→ desktop-continuous notification → timeline
                                        └→ web-remote-replayable snapshot → timeline
```

Adjacent thought chunks with the same message id append to one streaming segment.
Changing message id, assistant text, a new tool call, or a plan closes the segment.
Updates to an existing tool do not terminate an unrelated streaming thought.
New thought segments retain their event position. Duration uses Host receipt times,
not model computation estimates. Successful end_turn closes remaining thoughts;
stop, cancelled/limited/refused prompt, failure, process exit and Host restart mark
remaining thoughts interrupted. Finalized segments never accept late appends.

Keep existing exact native session, workspace identity, remote session, connection
generation and active-run guards. Initialization/load transcript replay remains
ignored because the Host already owns saved entries. Reconnect reads the same saved
revision, without duplicating entries or reopening completed segments. Legacy
snapshots without thought/plan entries remain readable. Search continues to match
user/assistant chat text only, excluding tool logs, thoughts and plan metadata.

## Acceptance

1. A fake stdio Agent emits thought, text, plan and tool updates: corresponding typed
   updates reach Host in order; another native session and load replay are ignored.
2. Host receives thought → tool → thought → text. Segments append correctly, remain
   ordered and finish before the next activity. Existing-tool updates do not split
   thought chunks. Completion, stop, failure and restart preserve partial text with
   correct terminal states; detached callbacks cannot mutate a newer turn.
3. Multiple full plans replace one turn's plan, retaining position, priority and
   reported statuses. Empty plans clear earlier steps. Next turns get separate plans.
4. Persisted snapshots and notifications carry the same entries and revisions.
   Reopening/replaying them keeps ids and content, including interrupted segments.
5. Actual timeline E2E at desktop and mobile widths in light/dark themes checks
   reasoning collapse/expand, streaming text, shared reasoning visibility, plan
   replacement and expansion, interruption, and snapshot remount without duplicates.
   Ordinary API reasoning and Todo presentation retain their existing behavior.
6. Execute relevant stdio/service/projection regression tests plus typecheck, lint,
   architecture check and targeted formatting checks; report actual results.
