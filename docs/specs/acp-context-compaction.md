# ACP context compaction

## Rules and ownership

The target Host ACP session owns compaction entries in the existing ordered,
revisioned transcript. Advertise `session.compaction: {}` and accept typed
`compaction_update` / `compaction_summary_chunk`. Also recognize legacy tool
notifications carrying explicit `_meta.contextCompaction` (`true` or an object
with positive integer `version`). Never infer compaction from tool titles.
Later partial updates for a recognized legacy tool retain its compaction identity.
Both wire formats use one Host upsert path and one entry per command/Agent ID.

Persist status, optional explicit origin, finite nonnegative token counts and
bounded text summary/error. Unknown statuses do not invent successful completion;
they remain running until a known terminal update or interruption. Summary chunks
only append to an existing running entry, with a 32,000-character total limit.
Typed summary/error patches preserve omitted values, clear null/empty values and
replace concrete values. Only failed entries retain an error. Terminal lifecycle
never regresses, but same-status terminal patches can update summary/error.
First receipt fixes entry position/time. An existing legacy tool that later gains
explicit compaction metadata converts in place rather than creating a second row.

Prompt completion without a compaction terminal event, stop, failure, process exit
and Host restart cancel unfinished compactions. Do not infer successful compression
from a successful prompt. Preserve existing generation, active command, deletion,
native session and workspace identity guards. Initialization/load replay is ignored;
historical tools whose metadata was discarded cannot be classified retroactively.

## Delivery and display

```mermaid
sequenceDiagram
    participant A as ACP Agent
    participant C as stdio adapter
    participant H as Host ACP session owner
    participant D as Desktop continuous timeline
    participant M as Mobile replayable timeline
    A->>C: typed event or explicit legacy metadata
    C->>H: normalized compaction update (native session scoped)
    H->>H: check generation/active command; upsert; persist revision
    H->>D: continuous snapshot notification
    H->>M: persisted snapshot / gap recovery
```

Project entries to the existing API `timelineMarker` compact divider in the
assistant-work lane, with running/success/failed/cancelled states. They do not enter
ordinary tool groups. Only explicit auto origin uses the automatic-completion
label; missing origin uses the neutral completion label. Reuse API themes,
animation, folding and translations on desktop and mobile. This change displays
Agent-reported compaction; it does not add a manual command or synthesize token
usage, cache hits or context capacity from compaction metadata.

## Acceptance

1. Synthetic stdio verifies advertised capability, both wire formats, summary
   patches/chunks, partial legacy updates, rejection of malformed metadata and
   suppression of native-session mismatch and load replay.
2. Host tests verify in-place updates, terminal monotonicity, bounded summaries,
   persistence/notification parity, interruption on all endings, restart and
   rejection of stale callbacks. Legacy snapshots remain readable.
3. Projection tests validate protocol schemas, stable row identity/order, terminal
   labels, neutral/automatic origin and separation from tools without mutation.
4. Actual timeline E2E covers running to terminal transitions, snapshot remount,
   mobile/desktop widths and light/dark themes with no duplicated marker.
5. Run focused regressions, typecheck, lint, architecture and format checks.
