# ACP session summary inventory

## Product rule

Listing ACP conversations reads bounded summaries, without hydrating every conversation body into the Host's resident session maps. Opening one conversation still restores its full checkpoint and journal. Search with a text query may inspect bodies, but must not retain cold bodies after the search.

The internal full-list contract may restore only sessions belonging to the requested workspace. Usage statistics read cold sessions transiently and keep only user-turn timing and usage facts for aggregation, without making those sessions resident.

The existing workspace identity, hidden-session, provisional, superseded, archived, and empty-draft rules remain authoritative. Summary wire shape and ordering remain unchanged. No fixed list limit is introduced because existing ACP callers expect the complete scoped list.

## Owner and persistence

`AcpSessionStore` owns the durable checkpoint and journal. A versioned summary sidecar is a disposable projection of those files, never an independent accepted fact. It records a source fingerprint and the existing `AcpSessionSummary` shape. A matching fingerprint permits a summary read; missing, corrupt, or stale sidecars are rebuilt from one cold session at a time, without populating the committed snapshot cache. A successful non-streaming commit refreshes the sidecar; failed sidecar maintenance does not fail an already committed session write. Removal deletes the sidecar.

The ACP service owns live sessions and its workspace visibility rules. A list uses committed live snapshots when available and the store's cold summary reader otherwise. A full read remains the sole path that promotes a cold session into live state. The sidecar must not duplicate a mutable owner or create another write path for accepted session facts.

```text
commit -> checkpoint/journal -> optional summary projection -> list summary
                                           | stale/missing
                                           v
                                transient one-session rebuild
open -> full restore -> live owner -> conversation projection
```

## Ordering and failure semantics

- Source fingerprint checks bracket a cold summary read. If the source changes during it, retry; do not publish a summary against a different revision.
- A complete corrupt journal record remains an error. An incomplete trailing record is ignored by read-only inventory and repaired by the normal full-open path.
- Legacy checkpoint-only sessions acquire a derived activity time from checkpoint mtime until full-open migration persists that value.
- Cold summaries display stale running sessions and terminals as interrupted and pause their queue; opening the session remains responsible for the actual durable recovery transition.
- In-process accepted writes are serialized by the existing per-session write gate; UI events still follow durable commit. Desktop continuous and mobile replayable conversation delivery are unchanged.
- The sidecar contains no credentials or extra history beyond fields already present in `AcpSessionSummary`.

## Acceptance scenarios

1. Listing hundreds of cold sessions does not add their full bodies to the Host's resident maps or store committed cache.
2. Repeated lists reuse valid sidecars; journal append and checkpoint replacement invalidate them, including after a crash between data and sidecar writes.
3. Legacy sessions, hidden/delegated sessions, draft sessions, remote workspace identities, and archived workspace lists retain current visibility rules.
4. Search finds older user and assistant text with exact entry IDs, without retaining all cold sessions. Opening the result still returns complete history.
5. Sidecar corruption or write failure cannot lose accepted history; deleting a session removes its sidecar.
