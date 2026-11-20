# Project Credential Scope

## Behavior

- Credential management is a system-level settings surface, independent of the currently active workspace. It lists every known project from the shared project-management source (recent projects plus open project tabs), and the user selects a project to inspect and manage its attachments.
- The scope list also contains a Global entry. A credential assigned globally is available to every project and appears as inherited, read-only metadata in each project's list; edits and removal are managed from Global.
- Credentials are created in the Host vault as unassigned. Creating one does not attach it to the selected project or Global.
- A project explicitly selects an unassigned credential to attach it. A project can have many credentials; one credential can be attached to at most one project at a time. Detaching returns it to the unassigned pool so another project can select it.
- Global explicitly selects an unassigned credential to make it available to all projects. Detaching it from Global returns it to the unassigned pool.
- The selected project's list shows project-owned credentials and inherited global credentials as separate groups. The unassigned pool remains visible regardless of scope selection and can be attached to the selected project or Global.
- `workspaceIdentity?.trim() || workspacePath` is the canonical project identity. The environment field is only the credential's target classification (`development`, `test`, `staging`, or `production`).
- The Host owns vault persistence, encryption, and attachment state. UI receives metadata and `hasSecret`, never secret values.

## Ownership and interface

- `CredentialService` owns credential records and their unassigned/global/project scope. It validates scope and project identity for attach, detach, project list, edit, rotation, and delete operations.
- `CredentialVaultRepository` persists scope separately from the nullable `workspace_identity`; null identity alone continues to mean unassigned unless scope is explicitly global.
- The settings UI owns the selected project or Global view as local state, creates unassigned records, and issues explicit scope commands. The project list comes from the existing shared project-management hook.

## Invariants and failure behavior

- New records have `scope: unassigned` and `workspaceIdentity: null` until explicitly attached to a project or Global.
- Attach succeeds only for an active unassigned credential. A credential attached to another project cannot be listed or mutated through this project's scope.
- Global attach succeeds only for an active unassigned credential. Global records are readable in each project's list but only mutable through the Global scope.
- Detach succeeds only when the supplied project identity matches the current attachment.
- Global detach succeeds only for a global credential and returns it to unassigned.
- Missing identity fails closed for project operations. An unassigned credential can be created and listed without a project identity.
- A delayed project list response is discarded after the selected identity changes; a selection change also closes any dialog opened for the previous project.
- Existing records are unchanged by initialization. Existing non-null identities remain attached to their current project; existing null identities appear in the selectable pool.

```mermaid
sequenceDiagram
    participant UI as System Settings UI
    participant Projects as Project Management Source
    participant Host as CredentialService
    participant Repo as CredentialVaultRepository
    UI->>Host: save credential (scope = unassigned)
    Host->>Repo: persist encrypted secret reference and metadata
    UI->>Projects: list recent + open projects
    Projects-->>UI: projects with canonical identities
    UI->>Host: list unassigned / global / project(selectedProjectKey)
    Host->>Repo: query scope and optional workspace_identity
    Repo-->>Host: metadata only
    UI->>Host: attach / detach(entryId, selectedScope)
    Host->>Host: validate active scope and project identity
    Host->>Repo: conditional update workspace_identity
    Note over UI: discard a response after project scope changes
```

## Acceptance scenarios

1. A credential can be created without an active project and appears in the unassigned pool.
2. Creating a credential while viewing project A leaves it unassigned until the user explicitly selects it for A.
3. Project A can attach an unassigned credential and then list, edit, rotate, detach, or delete it.
4. Project B cannot list, attach, detach, edit, rotate, or delete a credential attached to A.
5. After detaching from A, the credential returns to the unassigned pool and can be attached to B.
6. The target environment remains visible but does not determine project ownership.
7. Secret values never appear in list responses or rendered UI.
8. The settings page lists all known projects and a Global scope even when the active workspace changes.
9. Attaching a credential to Global makes it visible in Global and as inherited in projects A and B, without making it project-owned.
10. A project cannot edit, detach, or delete an inherited global credential; those actions are available in Global.
11. A delayed project A list response is discarded after switching to project B or Global.
12. Existing project attachments remain project-scoped and existing null-identity records remain unassigned after migration.

## Migration boundary

Add a checked `scope` column to the current table. During initialization, existing rows with a non-null `workspace_identity` become `project`; rows with null identity become `unassigned`. No credentials or secret values are rewritten, and the existing identity column remains the project key only.
