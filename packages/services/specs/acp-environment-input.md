# Conversation environment admission

## Rules and ownership

- `createProjectEnvironmentService` owns the per-session environment input guard. ACP owns message validation, command admission, persistence and execution; the environment guard never owns a second message queue.
- `beginInput` is an internal structural boundary. Its callers may supply a complete ACP submission or API command together with `kind` and `sessionId`. It must validate and project only `workspacePath`, optional `workspaceIdentity`, `kind`, and `sessionId` before computing the environment key. Message IDs, text, attachments, workspace files, API envelopes and routing metadata are not environment fields.
- Key isolation remains `workspaceIdentity?.trim() || workspacePath`, conversation kind and session ID. `remoteSessionId` identifies the current attachment, not a new environment binding. Different identities at the same path must remain isolated.
- Public environment operations and MCP arguments retain their strict schemas. Invalid identity fields must still fail before acquiring a guard; ignoring unrelated internal fields must not relax external requests or bypass ACP submission validation.
- Each admitted input acquires one reference and releases it idempotently in the existing `finally` boundary. Environment rebinding checks the guard after its asynchronous idle check. Success and failure must both release their own guard without releasing another input's reference.

```mermaid
sequenceDiagram
    participant UI as Desktop or mobile composer
    participant ACP as Target Host ACP owner
    participant Env as Environment owner
    participant Disk as Session store
    UI->>ACP: sendText / existing commandId
    ACP->>Env: beginInput(structural scope + kind + sessionId)
    Env->>Env: validate identity projection; acquire guard
    ACP->>ACP: validate submission, scope and deduplicate
    ACP->>Disk: commit user row or pending queue item
    Disk-->>ACP: committed revision
    ACP->>Env: finally release guard
    ACP-->>UI: bounded durable receipt
    Note over ACP,Env: environment changes also require an idle session
```

## Delivery and migration boundary

This is an internal validation correction with no schema migration, new RPC, queue owner or retry path. Desktop `desktop-continuous` and mobile `web-remote-replayable` keep their existing owner/lease, command ID, ACK recovery, snapshot and stream semantics. The source change must be built into the desktop Host before it affects an already installed application.

## Acceptance

1. A local ACP send with `id`, `commandId`, `text`, `attachments` and `workspaceFiles` reaches admission through the real environment service without an `unrecognized_keys` error, even with no selected environment.
2. A routed ACP send preserves workspace identity and attachment in the command receipt; routing metadata is excluded from the environment key. Whole-turn `prompt` and legacy `submitPrompt` use the same corrected guard.
3. Internal ACP and API structural inputs still prevent an environment switch during admission. A different workspace identity or conversation remains independent; repeated release is harmless.
4. Malformed identity fields still reject. Public environment operations still reject unexpected message fields. ACP validation still rejects malformed submissions and releases its environment guard on failure.
5. The existing real Host/composer browser scenario exercises local desktop and routed mobile sends with the real environment guard enabled, alongside stop/reuse behavior.
