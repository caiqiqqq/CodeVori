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
- The top-left repository title opens a searchable project picker backed by the
  window's existing workspace tabs. Search names, paths and remote subtitles;
  show all matching projects in a bounded, keyboard-accessible scrolling list.
  Display paths and remote subtitles to distinguish identical project names.
  Exclude conversation-only workspaces, deduplicate by
  workspaceIdentity.trim() || workspacePath. Only main projects are selectable:
  exclude confirmed local linked worktrees, including ones whose main project
  is not open. Reuse the sidebar's Git worktree relation hook, not directory-name
  heuristics or additional forge/account discovery. While local relations are
  unresolved, show loading rather than briefly offering worktree options; failed
  relation queries keep their unknown projects visible. Unavailable local
  directories and remote tabs without a live session are visible but disabled.
- Selecting a project activates its exact existing workspace tab and stays in
  Repository Panel. The right-hand remote selector only changes the selected
  project's Git remote. Project selection does not create/resume a conversation,
  call startDraft, change providers, close conversation tabs or clear composer
  drafts. The existing account/non-Git/missing-remote empty states still apply,
  and the picker remains usable in empty, loading and error states.
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
- GitLab issue and merge-request list reads set with_labels_details=true so
  labels include their native colors in the existing list response. Normalize
  detailed label objects through the existing shared label parser and reuse
  RepositoryLabels in the outer list as in the detail. Preserve literal names,
  valid provider colors and the existing neutral fallback for missing/invalid
  colors or older name-only responses. Keep provider page/search/filter semantics;
  do not add per-item detail/label requests, wait for the filter label catalog,
  or maintain a second color cache in Renderer. A catalog permission failure
  must not remove colors already returned by the item list.
- Item details show Markdown description, comments, labels, author, state and
  timestamps. Change requests also show source/target branches, changed-file
  patches and checks. Partial permission failures are reported per section,
  rather than making a successfully loaded item disappear.
- Item details replace the list inside the repository main view, rather than
  opening a narrow side drawer. Keep the application's navigation and project
  scope; show repository/item breadcrumbs with a back command, title and actions,
  a wide description/activity column and a compact attributes column. On narrow
  screens attributes stack after the description/activity. Returning to the list
  preserves its filters, page and remote. This is a native detail presentation,
  not an embedded forge website or a second login surface.
- Attributes include assignees and milestone on every supported provider;
  GitLab additionally shows due date, estimated/spent time, confidentiality,
  participants, task completion and linked issues when its API permits reading
  them. Empty supported fields show an empty value; unsupported fields are
  omitted. Labels use their provider colors. Attribute reads are optional:
  permission/version failures are shown on their affected sections without
  discarding the description. Base item, activity and supplemental attributes
  load independently through the same bound Host. getForgeItemExtras returns
  only the supplemental projection; useRepositoryItem merges it for display,
  with the same generation guard as the base snapshot. Slow supplemental reads
  never block the description or the state validation before a confirmed write.
  Malformed optional responses are isolated like permission errors. Attributes
  are read-only; do not add placeholder
  edit, upload, reaction, assignment or create-MR controls without write APIs.
  Calendar due dates do not shift to another day in negative UTC offsets; zero
  spent time is shown as zero rather than an unset estimate.
- GitLab notes include system notes as activity, with a local all-activity /
  comments-only filter. GitLab label changes are read from the same item's
  resource_label_events API; they are not present in the notes API. Normalize
  them as typed system activity with add/remove actions and colored labels.
  Group only events sharing the exact creation timestamp, actor and action;
  keep different actors/actions separate. Deleted labels retain their activity
  with a localized deleted-label placeholder. Never infer label changes from
  comment text or interpret label names as Markdown/HTML.
  The bound Host GitLab adapter owns the chronological activity projection.
  Independently read both sources in parallel, following each source's server
  pagination. Read the complete bounded label history and only the notes prefix
  needed for the requested combined page, including notes at the cutoff timestamp
  so tied timestamps cannot move already emitted rows, then sort by creation time and stable
  namespaced ID, group/deduplicate label events, and paginate the combined rows.
  Preserve the existing page/pageSize/hasMore contract; totals count grouped
  activity, not raw label events or comments only. Unknown note totals remain
  unknown until exhausted. Each source is limited to 100 pages of at most 100
  rows; invalid or non-progressing pagination and histories exceeding that bound
  fail explicitly rather than returning a silently incomplete timeline.
  A failed label-event read fails the activity section while leaving the
  independently loaded item/attributes usable. Do not silently switch to
  notes-only pagination, which would duplicate or skip rows after earlier pages.
  Other forge providers keep their existing pagination. Pages containing only
  system activity remain loadable; filtering must not suppress the load-more command.
  System notes are not ordinary comment bubbles. Posting, close/reopen and PR
  merge still use the existing confirmed mutation path and refresh the detail.
- Repository Markdown uses the existing safe Markdown renderer with an opt-in
  web-content context. Relative URLs resolve against the item/repository URL;
  GitLab `/uploads/...` links resolve under the selected project, including
  nested groups and self-hosted base paths. Never reinterpret repository text as
  local files, artifacts or workspace navigation. Do not render executable HTML.
  Inline images occupy the description's width, retain their aspect ratio and
  use the existing image preview dialog for zooming. Chat Markdown stays unchanged.
- Private GitLab upload images are read through the bound Host IGitService using
  the existing account and GitLab's authenticated uploads API. Validate the
  current repository/account, origin and exact project-upload path before any
  HTTP request. Do not fetch arbitrary same-host paths, another project's uploads,
  credential-bearing URLs, redirects, SVG/HTML or local files. Image payloads are
  bounded raster data; credentials never cross RPC or appear in image URLs/logs.
  GitLab introduced downloads by upload secret/filename in 17.4. An API 404
  may use the exact validated project upload URL through the same Host, using
  an account-specific native browser session when available. API 401/403,
  malformed payloads and network failures do not trigger this compatibility
  path. All image transports retain the same raster/size/redirect limits.
  A legacy private project requiring web authentication shows an explicit
  sign-in action. Only that user action opens a native, dismissible GitLab
  sign-in window; loading/switching issues never opens an authentication window.
  The window verifies the selected account's username. Main owns the temporary
  native window/cookies, persisted by Electron's browser session storage. The
  native transport validates that session against the bound GitLab API before
  reading a file. Main uses Node's manual-redirect HTTP transport with the
  explicitly selected cookie; Electron's Session.fetch cancels manual redirects
  instead of exposing their status. A login redirect must remain a recoverable
  authentication result, with no follow-up request to its destination.
  Host remains the selected repository/account owner. The window
  may use the GitLab web origin attested by the selected project's authenticated
  API response; the API token is never sent to that origin. Tokens/cookies never
  cross the native transport, Renderer RPC, image URLs or logs. Only validated
  raster bytes or an authorization result return to Host. Re-resolve
  repository/account after authorization; removal, rotation or target changes
  reject late authorization. Cancellation, failed login and parent/Host disposal
  always close the window and settle the request.
  Treat the native window or its parent's close event as cancellation before awaiting closed:
  aborting its navigation may reject loadURL before the closed event arrives.
  Closing during navigation must not leave a pending command or report a network
  failure. Session expiration requires
  sign-in again. The Host's native bridge coalesces concurrent sign-in commands
  for the same server/account/user/login origin; each caller still revalidates
  its repository/account after completion. This admission is transient, cleared
  on completion or Host disposal, and never starts sign-in during image reads.
  Aborted reads or authorizations cannot report a late success. Hosts without a
  native sign-in capability keep the original-page
  action and report that legacy authentication is unavailable; never route a
  remote Host's operation through the app-global local Git service.
  A web session signed in as another username also shows the explicit sign-in
  action, explaining the account mismatch instead of leaving an unrecoverable
  generic image error.
  Public external images may render without forge credentials and a referrer.
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
- Detail metadata remains a provider-normalized read projection, with additive
  optional fields for old fixtures/Hosts. The existing detail hook owns accepted
  detail/activity snapshots; the detail component owns its activity filter and
  unsent comment. Each image hook owns only its temporary object URL/loading
  projection, keyed by Host + exact repository/account target + source URL.
  Scope changes/unmount invalidate old image responses and revoke object URLs.
  There is no new durable issue cache, accepted mutation queue or account owner.
- Settings covers the workspace without unmounting it. The shell passes its
  existing visibility state to the repository hook. While covered, do not start
  discovery and invalidate any pending discovery response. On return, rediscover
  through the same workspace Host, reflecting successfully saved account changes
  without manual refresh or a second account cache. Preserve filters and detail
  drafts if the repository/account key is unchanged. The native detail and
  portal-based confirmation, image-preview and new-issue dialogs follow that
  visibility without discarding local drafts or blocking the settings layer.
  Hiding/resuming a detail or dialog must not submit a
  pending comment, new issue or confirmation. Do not use timers or read
  local settings to resolve a remote Host's accounts.
- Navigation history belongs to zcodeSessionStore. Repository entries use the
  existing browser-style stack, remain separate from task lifetime and restore
  without pushing another entry. Conversation selection and drafts survive
  repository navigation.
- The project picker owns only its open/search UI state. TabStore remains the
  selected-workspace owner, and useWorkspaceTaskNavigation is the only project
  selection admission path: validate the existing identity, activate that tab,
  then push a repository history entry and request the repository main view.
  Selecting the current project is idempotent. Missing/closed targets must not
  push history or accidentally activate a same-path remote/local tab. Back and
  forward restore the exact project through existing repository history without
  adding another entry. The panel's identity/session key replaces old repository
  filter/detail drafts immediately; generation guards ignore late Host replies.
- The panel wrapper owns the existing Git worktree relation projection, outside
  the keyed repository content, so changing projects does not restart relation
  discovery. The shared relation hook cancels old replies on tab/Host changes.
  The picker only reads the main-project projection. An active worktree marks
  its opened main project as selected; this is display-only and does not rewrite
  the active workspace, history, Git remote, conversation or composer scope.

```text
sidebar -> existing navigation owner -> repository main view
project picker -> exact existing TabStore target -> activate workspace
               -> existing repository history -> repository main view
               (conversation selection / composer drafts unchanged)
opened local tabs -> existing Git relation hook -> main-project picker options
                  (linked worktrees excluded; unresolved local options withheld)
workspace identity + remote -> hook -> bound Host IGitService
                                   -> Git remote + encrypted account
                                   -> provider API -> normalized snapshot
GitLab item list -> same bound adapter -> list API with label details
  -> existing label normalization -> colored labels in the existing page
  -> RepositoryLabels (independent of the filter catalog, no extra item requests)
detail/filter change -> request generation -> matching reply only
detail open -> same Host -> item / activity / extras in parallel
                        -> guarded detail projection -> native main-view detail
                                                     -> optional section errors
GitLab activity -> same bound adapter -> notes prefix / complete label history in parallel
  -> source pagination -> label event ID deduplication + exact actor/time/action grouping
  -> chronological combined page -> existing guarded detail projection
activity filter -> local rendering only (combined load-more remains available)
activity source error -> section error (never change pagination membership)
repository image -> bound target validation -> allowed GitLab upload API
                 -> bounded raster bytes -> temporary object URL -> preview
API 404 -> exact validated project upload + account web session -> same raster limits
legacy authentication required -> explicit sign-in action -> bound Host command
  -> native window -> native browser session -> matching user -> Host revalidates
  -> image retry through the same Host -> native raster-only response
cancel / Host or parent disposal -> close native window -> settle authorization
old detail/image owner reply -> ignored; temporary object URL -> revoked
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
- Unit: picker options exclude conversation-only targets, deduplicate trimmed
  identities without conflating same-path remote/local projects, exclude linked
  worktrees with/without an opened main project and disable unavailable or
  disconnected targets. Unknown, non-Git and unrelated same-name projects remain
  visible; remote tabs never inherit local worktree classification.
- E2E: select from the top-left title, search names/paths/remote subtitles,
  distinguish duplicate names, scroll a long list and select with the keyboard.
  The list omits linked worktrees during and after relation discovery; an active
  worktree highlights its main project without changing the actual scope. Project
  changes reuse the relation projection. Selection and back/forward load the
  correct Host/workspace, do not create
  conversations and preserve selected tasks and unsent composer state. Repeated
  selection deduplicates history; closed targets do not navigate. Remote changes
  remain scoped to the selected project; item handoff uses that exact workspace.
  Verify the picker in non-Git/error states, narrow widths and light/dark themes.
- E2E: sidebar entry, list/tab/search/state/page flows, missing-account recovery,
  details/comments/files/checks, create/comment/close/reopen/merge confirmation,
  agent draft handoff, delayed old replies after workspace/remote changes,
  mobile layout, light/dark themes and no horizontal overflow.
- Unit: GitLab/GitHub/Gitea detail metadata normalization; GitLab system-note
  pagination, task totals, optional participants/links/label failures; safe web
  relative URLs with nested groups/base paths; authenticated upload URLs,
  repository/account changes, wrong origins/projects, encoded traversal,
  redirects, oversized/non-raster responses and no credential disclosure.
- Unit: separate GitLab notes/label endpoints; missing label dynamic is recovered
  as one row for two labels added in the same batch; add/remove, author/time
  separation, colors, deleted labels, stable IDs and duplicate source records.
  Follow label source pages, including groups split across pages; combined pages
  are ordered, disjoint and complete. Bound note-prefix reads, correct combined
  hasMore/totals, missing headers, source failures and malformed/endless source
  pagination. The base item still loads when its activity source fails.
- Unit: GitLab issue/MR lists request detailed labels and retain their native
  colors, names, server pagination/search/filters without reading item details
  or a separate label catalog. Name-only labels and invalid CSS colors retain
  the neutral fallback.
- Unit: pre-17.4 uploads use only validated project URLs after API 404; private
  uploads need a matching web session. API authentication/permission failures
  never fall back. Web redirects, expired sessions, mismatched users, removed or
  rotated accounts and changed repositories never authorize a new target or
  disclose credentials. Browser session storage belongs only to Main.
- Native authorization: successful existing session, explicit sign-in, cancellation,
  failed navigation and parent/Host disposal settle exactly once and remove
  listeners/windows. No token/cookie crosses Renderer RPC or image URLs.
  Concurrent same-account sign-in commands share one native window; malformed
  user data and late responses after abort cannot authorize the selected account.
- E2E: legacy image sign-in action is explicit, disabled while pending, retry
  loads raster pixels after authorization; cancellation and stale owner replies
  do not block the detail or replace a newer project's image.
- E2E: native two-column details and narrow stacked attributes, real rendered
  image pixels/aspect ratio and image zoom, failed/retried private images, no
  local-file requests from Markdown, all-activity/comments-only pagination,
  retained list filters and comment drafts, stale image/detail replies, settings
  coverage, existing confirmed actions and light/dark screenshots. Synthetic
  Hosts only; live self-hosted GitLab version/permissions remain separate proof.
- E2E: a grouped label activity displays its author/time and two colored literal
  labels once; add/remove and deleted-label copy is localized. Comments-only
  hides label/system activity without blocking load-more, restores all activity
  without refetching, and retains comment drafts. Verify narrow and light/dark
  layouts with no horizontal overflow.
- E2E: outer list shows both colored labels, including a native-colored label
  absent from the filter catalog; pagination and issue/MR switching retain the
  colors. Verify list label colors on narrow/light/dark layouts.
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
