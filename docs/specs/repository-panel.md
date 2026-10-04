# Repository Panel

## Product Rules

- Add Repository Panel to the workspace sidebar, alongside Automations and
  Plugins. Follow Codeg's repository workflow, while using ZCode's typography,
  controls, themes and existing workspace navigation. Keep the local Git review
  pane and Version Control settings unchanged.
- The panel follows the selected workspace Host, including remote workspaces.
  Select a configured Git remote, defaulting to origin when present. Worktrees
  use their own Git remote configuration. No repository cloning or Git mutation
  happens when opening the panel.
- Support GitHub (including Enterprise), GitLab and Gitea/Forgejo. Reuse the
  encrypted accounts in Version Control settings. Match protocol/host/port/base
  path for HTTP remotes and hostname/base path for SSH remotes; an SSH transport
  port is not an HTTP API port. The most specific matching server wins, with the
  default account preferred. Generic Git credentials are not forge credentials.
- Unknown hosts require an explicitly configured forge account. Do not guess
  that a private host is GitHub. Missing credentials, unsupported hosts, missing
  Git/remotes and disconnected Hosts have distinct recoverable empty states.
  Account configuration opens Settings -> Version Control.
- When accounts are saved but none can be used for the selected remote, discovery
  returns account-mismatch rather than implying that no account was added or
  that the provider is unsupported. Show the current remote host and direct the
  user to configure its forge account. Generic Git credentials also do not
  satisfy this requirement. Do not expose other accounts or their secrets, infer
  a self-hosted provider from its name, relax server matching, or test credentials
  during discovery. With no saved accounts, retain missing-account for known
  providers and unsupported for unknown providers or invalid remotes.
- Provide Issues and Pull Requests (Merge Requests on GitLab), open/closed/all
  state, search, provider-supported ordering, label filters and pagination.
  Never display a sorting choice that its provider ignores. Server pagination
  remains authoritative; GitHub search's reachable-result limit is respected.
  GitLab uses opened for open queries; closed MR pages include merged requests
  by filtering all-state server pages, retaining their pagination and hiding
  the unfiltered total. Gitea's fixed server ordering has no sort control.
- Item details show Markdown description, comments, labels, author, state and
  timestamps. Change requests also show source/target branches, changed-file
  patches and checks. Partial permission failures are reported per section,
  rather than making a successfully loaded item disappear.
- Users may create an issue, publish a comment, close/reopen an item and merge a
  ready change request. Closing/reopening and merging require confirmation;
  no remote mutation runs automatically. Merge reads the latest head/state and
  passes the observed head SHA to the provider, refusing stale heads, drafts,
  conflicts and unsupported merge strategies. No branch is deleted implicitly.
  Available methods are read from repository settings. A settings permission
  failure disables merging without hiding the item, comments or files.
- Open repository/item/check links through IPlatformService. Validate external
  links as HTTP(S) URLs and never display a credential-bearing remote URL.
- "Handle with agent" creates an existing ZCode conversation draft prefilled
  with the item's title, URL and description. API and ACP use the same composer;
  no automatic prompt, branch switch, worktree creation or remote writeback is
  introduced. External issue text is identified as untrusted source content.

## Ownership And Boundaries

- The Git Host owns remote discovery, accepted account selection and API calls.
  Public typed operations are exposed through IGitService; shared Zod schemas
  validate requests at the service boundary. Credentials never cross RPC.
- The current workspace services, not the app-global local services, own reads
  and writes. Every request carries workspacePath and optional workspaceIdentity;
  renderer keys use workspaceIdentity.trim() || workspacePath plus remote name.
  Disconnected remote workspaces must not fall back to local services.
- Remote reads return a stable repository key. Subsequent item/list/write
  requests must present that key and selected account ID. The Host re-resolves
  the remote/account and rejects a changed target before making any HTTP call.
- The repository hook owns read snapshots and UI drafts. Filter/page/detail
  replies are generation-guarded; switching workspace, Host, remote or account
  hides old rows immediately and ignores old responses. Mutations admit once,
  do not retry automatically and cannot unlock a newer Host's mutation.
- Settings covers the workspace without unmounting it. The shell passes its
  existing visibility state to the repository hook. While covered, do not start
  discovery and invalidate any pending discovery response. On return, rediscover
  through the same workspace Host, reflecting successfully saved account changes
  without manual refresh or a second account cache. Preserve filters and detail
  drafts if the repository/account key is unchanged. Portal-based detail and
  new-issue dialogs follow that visibility without discarding their local drafts
  or blocking the settings layer. Hiding/resuming a dialog must not submit a
  pending comment, new issue or confirmation. Do not use timers or read
  local settings to resolve a remote Host's accounts.
- Navigation history belongs to zcodeSessionStore. Repository entries use the
  existing browser-style stack, remain separate from task lifetime and restore
  without pushing another entry. Conversation selection and drafts survive
  repository navigation.

```text
sidebar -> existing navigation owner -> repository main view
workspace identity + remote -> hook -> bound Host IGitService
                                   -> Git remote + encrypted account
                                   -> provider API -> normalized snapshot
detail/filter change -> request generation -> matching reply only
confirmed write -> target/head validation -> one API write -> refresh snapshot
handle item -> existing create-task action -> shared API/ACP composer draft
settings account save -> encrypted Host account owner -> settings response
return to repository -> shell visibility -> new discovery generation
                                        -> same Host account match -> snapshot
covered/previous generation reply -> ignored (no credential or queue replay)
```

- Use the existing Host HTTP transport for proxy/custom-CA behavior. Never attach
  application API credentials, follow credential-bearing redirects, send tokens
  in URLs, echo response bodies into errors or log secret/request headers.
  Requests have bounded timeouts/body sizes and provider-specific parsing.
- Conversation desktop-continuous and mobile web-remote-replayable delivery is
  unchanged. Repository operations are fresh request/response reads; the remote
  forge is authoritative, with no extra durable task queue or credential store.

## Validation

- Unit: SSH/HTTPS remotes, nested GitLab groups, self-hosted base paths,
  protocol/host/port matching, explicit providers, generic/missing accounts,
  safe URLs, exact endpoints/headers, provider pagination and search escaping.
- Unit: a saved GitHub account does not satisfy a self-hosted GitLab remote;
  mismatches and generic credentials have an explicit account-mismatch status,
  with no HTTP requests or unrelated account metadata in discovery responses.
  Adding a matching account makes fresh discovery ready, while unrelated/default
  accounts remain unchanged. Stale requests missing their account fail before IO.
- Unit: invalid schemas, forbidden/authentication/network failures, redirects,
  stale repository/account keys, normalized item/comment/check/file results,
  confirmed state changes and SHA-protected merge behavior. Synthetic tokens
  and local mocks only; never mutate a real remote repository in tests.
- Navigation: repository entries deduplicate, respect workspaceIdentity, work
  with back/forward and are not removed when a task is deleted.
- E2E: sidebar entry, list/tab/search/state/page flows, missing-account recovery,
  details/comments/files/checks, create/comment/close/reopen/merge confirmation,
  agent draft handoff, delayed old replies after workspace/remote changes,
  mobile layout, light/dark themes and no horizontal overflow.
- E2E: distinguish absent accounts from mismatched saved accounts; follow the
  Version Control action, add a matching synthetic GitLab account and return to
  the still-mounted panel without manual refresh. Failed additions keep the
  mismatch state. Covered panels issue no discovery; delayed covered replies do
  not overwrite a newer result. Detail/comment and new-issue drafts survive
  a settings visit without a modal blocking settings or any automatic writes.
  Verify mismatch copy on narrow/dark layouts.
- Execute focused tests, pnpm typecheck, pnpm lint, changed-file architecture
  check, formatting and git diff --check. Report unavailable live provider
  verification separately from synthetic coverage.

## Discovery Note

The current feature seed graph has no repository-panel seed, and its referenced
maintainer graph-contract document is absent. Source/contracts above are the
authority; this is a graph-drift candidate, not evidence of absent Git support.
