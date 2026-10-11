# Repository Panel

## Repository Markdown parser isolation

- Relative image and link resolution uses the current content context for every
  supported forge: GitHub.com, GitHub Enterprise, GitLab (including nested groups
  and server base paths), and Gitea/Forgejo. Do not reuse a previous repository,
  item, account or Host's resolver after switching, including same-provider and
  same-URL targets on different Hosts. Generic Git has no issue/media adapter.
- Streamdown caches processors by plugin name and serialized options, rather
  than function identity. Use a stable plugin with an explicit content-context
  epoch in its options. The existing Markdown context identity owns this epoch;
  it is transient, contains no credentials, and is also the render remount key.
  Parser reuse cannot retain an older resolver. Do not fix this by recognizing
  a hardcoded GitHub URL after it has already been rewritten incorrectly.
- Parse raw HTML before rewriting its img/src and a/href targets; then run the
  existing sanitizer and URL hardening. Markdown and HTML use the same resolver.
  Preserve safe external absolute URLs and reject executable/local URLs.
- Address resolution does not grant attachment authorization. Retain the bound
  Host's media adapters and their exact target/path guards. GitHub Enterprise
  and Gitea/Forgejo attachment reads use the same bound Host/account path as
  GitHub.com and GitLab. A shared pure classifier owns the UI/Host URL contract;
  the Host revalidates the actual repository/account before every read.
  Do not send credentials to arbitrary same-origin URLs or claim support for
  every custom server's SSO/object-storage configuration from forge discovery.
  Pre-create upload capability remains provider-specific and unchanged.

### Self-hosted attachment transport

- Derive the server base path from the verified repository URL and encoded
  owner/repository name. Require the configured HTTP(S) origin, port and base
  path, with no URL credentials, query or fragment. Preserve HTTPS-only
  GitHub.com attachment rules. Renderer receives only bounded raster bytes.
- GitHub Enterprise accepts `/user-attachments/assets/<UUID>` under the server
  base and legacy `/files/<numeric-id>/<filename>` (one safe filename segment).
  Only these endpoints receive the selected account's Bearer token. Reject
  Enterprise-to-GitHub.com and other servers' attachment addresses.
- Gitea/Forgejo accepts `/attachments/<UUID>` under the server base and the
  current repository's `/attachments/<UUID>` or
  `/issues/<positive-index>/attachments/<UUID>` links. Normalize these UUIDs
  to the server's token-enabled `/attachments/<UUID>` download route; its
  permission check decides access. Issue attachment API responses are metadata,
  not image bytes. Use `Authorization: token` only at this canonical route.
- Self-hosted adapters do not follow redirects: custom SSO/login and external
  object-storage redirects require an explicit future server contract. Keep
  retry/original-page actions and report failure without anonymous fallback or
  forwarding credentials. Existing GitHub.com signed-storage allowlist and
  GitLab isolated web login remain unchanged. All adapters retain the 15s timeout,
  12 MiB limit, raster MIME/signature validation and sanitized error codes.

```text
repository image -> shared endpoint classifier -> existing useRepositoryImage
  -> selected Host -> target/account revalidation -> same classifier
  -> provider token at canonical endpoint -> bounded raster -> hook-owned blob
scope change -> cancel projection/revoke blob -> discard stale Host reply
desktop + mobile -> same selected Host/service (no new session or stream state)
```

Acceptance: direct modern/legacy Enterprise and Gitea/Forgejo UUID downloads;
configured base paths, ports and HTTP(S) origins; credentials only at the exact
endpoint; reject foreign repository/server/base paths, encoded separators,
queries, fragments and changed targets before HTTP; reject login/storage
redirects, wrong MIME/signature, oversized bodies and network/auth failures.
Exercise real renderer Host reads, retry/zoom and stale Host/account switching
on desktop/mobile in both themes. Tests use synthetic servers; actual custom
server token/SSO behavior requires deployment-specific verification.

```text
current content context -> existing identity epoch -> parser plugin options
  -> raw HTML -> current URL resolver -> sanitizer/hardening
  -> repository image classification
     -> supported private attachment -> bound Host validation -> raster -> blob
     -> other web image -> credential-free image render
scope change -> new epoch/parser + existing hook cancellation/blob revocation
desktop and mobile -> same resolver + same selected Host (no stream changes)
```

Acceptance: render GitHub.com, Enterprise, two GitLab projects, Gitea and Forgejo
in one process in both orders, with base paths/ports and identical source text.
Verify Markdown/HTML images and links, project-relative GitLab uploads, absolute
external URLs and blocked local/script URLs. Synthetic browser E2E exercises
the real repository renderer across provider/Host/account/item switches and
new-issue-style web contexts; assert image pixels, exact Host read URL/target,
stale-response rejection and no token-bearing anonymous/foreign requests at
desktop/mobile widths in both themes. Existing image/login tests stay valid.

## Forge state filter and task progress

- The list dropdown filters only the forge item's open/closed/all state. Label
  the visible trigger and accessible control as Issue state or Request state;
  linked work-task progress is an independent presentation and never an input
  to this query. Do not infer issue closure from done, or completion from closed.
- Open issues may be processed; closed issues may have no task, or a pending,
  running, review or failed task. Changing the forge filter preserves task
  snapshots and progress. Do not introduce another task filter implicitly.
- Existing confirmed-close reconciliation still uses direct forge facts,
  keeping search-index lag and later reopening behavior unchanged. Desktop and
  mobile read the same scoped Host projections without new state or commands.

```text
Issue/Request state control -> scoped Forge list query -> matching item rows
Host task snapshot/events -> linked progress per matching row (read only)
Confirmed-close receipt -> direct Forge read -> authoritative item state
```

Acceptance: synthetic browser E2E verifies open + done, closed + todo/running,
unlinked open/closed, task-only status changes, all-state queries and merged
PRs. Preserve provider pagination and zero implicit task/forge writes; verify
visible labels and layout at desktop/320px in both themes.

## Linked task status colors (issue #62)

- The highlighted statuses in issue #62 are linked work-task progress, separate
  from the forge item's open/closed icon. Reuse the existing Host-owned task
  snapshot and status projection; no new state, persistence or command path.
- One repository task-status presentation owns the color mapping for list and
  detail controls. Todo/canceled use `foreground-subtle`; processing (queued,
  preparing, running or merge applying) uses `warning`; awaiting input uses
  `interaction-confirmation-foreground`; review uses `icon-blue`; done uses
  `success`; failed uses `destructive`. Done with unsettled forge writeback
  retains “processed, sync pending” and uses `warning`, ahead of done green.
- The status text and the list control's icon share the same color, including
  hover and disabled busy states. Keep localized status text, keyboard access,
  task navigation, retry/reprocess availability and forge state unchanged.
- Colors are a pure render-time projection of the current task snapshot. They
  must update immediately when the existing task event refreshes the shared
  list, for desktop continuous and mobile replayable surfaces alike.

```text
Host task owner -> existing scoped task event/snapshot -> shared UI task list
  -> repository status projection -> list icon/text + detail status text
```

Acceptance: synthetic browser E2E covers every task status, applying merge,
pending/failed/settled forge writeback, live status changes and task navigation;
list/detail computed colors match semantic tokens in Zai light/dark at desktop
and 320px widths. No real forge/model writes.

## Issue task lifecycle and writeback

- Host WorkTaskService/SQLite owns the durable source association: validated repository
  key, configured remote, pinned account, item kind/number and canonical URL/title.
  Creation validates through the existing Forge port; generic task editing cannot
  replace provenance. Legacy tasks remain unlinked; never infer links from prompts.
- One active task per workspace identity/path and repository/item. Creation performs
  the duplicate check inside the existing SQLite transaction. Done tasks may be
  processed again after their previous writeback has settled; failed/canceled tasks
  do not block reprocessing with a stale request from an earlier run. UI reads the existing shared task list (including archived tasks),
  refreshed by task events, instead of keeping a page-local created Set.
- Show task progress separately from the forge open/closed state: added, processing,
  waiting for input, awaiting acceptance, processed, failed, canceled. Clicking the
  linked status opens that task through existing task navigation. No start comment
  or automatic remote state change on creation, agent settlement, cancel or archive.
- Reuse completion dialog and merge controls for a linked item: optional result
  comment (editable, no transcript) and close-associated-issue (default on for issues,
  never for PRs). Local merge comments explicitly say merged locally, not pushed.
  Agent finish only enters review. Completion intent and step receipts persist before
  network IO; merge intent runs only after a successful merge reaches done.
- Task completion remains done if remote writeback fails. A pending/failed/uncertain
  writeback is visible on task and issue surfaces and can be retried explicitly,
  including after restart. No scheduler auto-retries external writes. Resume of a
  done conversation cannot execute an earlier run's writeback or reopen an issue.
- Successful receipts refresh the open detail and comment thread without discarding
  its composer draft. List rows for a confirmed close are reconciled with direct
  forge reads on each list snapshot, so a lagging search index cannot reinsert a
  closed issue. A subsequently reopened issue is shown from the new direct fact.
- Comment then close then reread authoritative state. Completed steps are not repeated.
  Persist a stable comment marker, reconcile uncertain sends against all comment pages
  before retry. If a send was interrupted and no marker is found, require explicit
  resend choice; never assume lack of ACK means lack of comment. A SQLite owner/lease
  serializes writers across Host instances; updates compare request id, owner and run.
  A closed issue is already satisfied; a reopened issue is not reclosed by a finished
  request. Target/account mismatch fails through existing Forge validation.
- Source and requests use task scope, never worktree scope; UI cannot redirect retries.
  Desktop continuous and mobile replayable retain the existing scoped Host task
  notification/list projection and owner/lease boundaries; no new Agent or Host.

```text
UI process draft -> Host validated create -> SQLite(source + task) -> task event -> shared list/chip
UI acceptance/merge choices -> Host SQLite(intent) -> task done -> acquire writeback lease
  -> reconcile/post marked comment -> persist receipt -> close/reread -> persist receipt -> event
failure/interruption -> done + pending/error -> explicit retry (same request, completed steps skipped)
```

Acceptance: real temporary SQLite + fake Forge tests cover provenance validation,
atomic duplicate admission, persistence/restart, workspace isolation, source immutability,
review versus done, partial failure, comment reconciliation, lease contention, stale run,
already closed issue, rejected target and no implicit writeback. Synthetic browser E2E
covers creation/reentry/status click, API/ACP completion options, failed retry, cancel,
merge choices, desktop/320px layouts and light/dark themes. No real forge/model writes.

## Product Rules

- Add Repository Panel to the workspace sidebar, alongside Automations and
  Plugins. Follow Codeg's repository workflow, while using ZCode's typography,
  controls, themes and existing workspace navigation. Keep the local Git review
  pane and Version Control settings unchanged.
- The panel follows the selected workspace Host, including remote workspaces.
  Restore the last selected Git remote for this workspace identity, defaulting
  to origin when no preference exists. Worktrees
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
- Remember the last successfully admitted Repository Panel project and each
  workspace's explicitly selected remote across panel unmounts and app/page
  restarts (issue #57). The UI-only repositoryNavigationStore owns this versioned
  browser-local preference; TabStore remains the active workspace owner and
  zcodeSessionStore remains the history owner. Store only path/identity and
  remote names, never accounts, credentials, remote session IDs or issue drafts.
  Keys are workspaceIdentity.trim() || workspacePath, so reconnecting the same
  identity restores its remote while same-path local/remote projects stay isolated.
  Sidebar entry with no explicit target tries the remembered project through
  the existing exact-tab admission path; a closed, conversation-only, unavailable
  or disconnected target falls back to the current project. Explicit picker
  targets and history replay take precedence and update the remembered project
  only after admission succeeds. A removed remote clears only its matching
  preference, then rediscovery uses the Host's existing origin/first-remote
  default. Late replies cannot clear another workspace or a newer selection.
  Storage corruption/unavailability uses defaults or in-memory preferences and
  must not block navigation. No preference is a forge/server fact or a command
  to create an issue, resume a conversation, reconnect or open a project.

```text
picker / sidebar / history -> existing exact-tab admission -> TabStore activation
  -> repositoryNavigationStore project preference -> existing history/view
remote selection -> scoped UI hook -> repositoryNavigationStore keyed preference
  -> guarded Host discovery -> list / explicit new-issue target
  -> removed remote: compare-and-clear preference -> Host default rediscovery
panel remount / page restart -> local preference -> same navigation/read paths
```

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
- GitHub.com issue/PR descriptions and comments read
  `https://github.com/user-attachments/assets/<UUID>` through the same bound
  Host IGitService and selected GitHub account. Anonymous reads of private
  attachments may return 404; do not treat these URLs as public images.
  Revalidate repository/account before reading. Only this exact HTTPS origin
  and attachment path may receive the account token; reject credentials,
  query/fragment, arbitrary paths, local URLs and Enterprise-to-GitHub reads.
  Follow at most one manually inspected HTTPS redirect to the exact GitHub
  image storage hosts `github-production-user-asset-6210df.s3.amazonaws.com`
  or `private-user-images.githubusercontent.com`, without account credentials
  or cookies. Signed storage URLs stay inside Host and never enter RPC/logs.
  Reuse the 12 MiB raster MIME/signature limits, temporary image URL lifecycle,
  retry/original-page actions and existing zoom dialog. Authentication failures
  do not invoke GitLab web sign-in or fall back to anonymous requests.
  No new persistence, accepted state, Main bridge or stream protocol is needed.
  Owner/event order: repository UI -> bound Host target/account validation ->
  allowlisted attachment read -> credential-free storage read -> bounded raster
  bytes -> hook-owned temporary URL -> existing preview; scope change/unmount
  discards late replies and revokes URLs, on desktop and mobile Web alike.
  Acceptance: service tests cover token destination, redirect rejection,
  auth/network failures, malformed/oversize payloads and stale target rejection;
  UI E2E covers actual image pixels/aspect ratio, failed-read retry, click zoom,
  comments and stale Host replies at 1280/375px in both themes. Existing GitLab
  sign-in and chat Markdown behavior must continue to pass.
- Users may create an issue, publish a comment, close/reopen an item and merge a
  ready change request. Closing/reopening and merging require confirmation;
  no remote mutation runs automatically. Merge reads the latest head/state and
  passes the observed head SHA to the provider, refusing stale heads, drafts,
  conflicts and unsupported merge strategies. No branch is deleted implicitly.
  Available methods are read from repository settings. A settings permission
  failure disables merging without hiding the item, comments or files.
- Open repository/item/check links through IPlatformService. Validate external
  links as HTTP(S) URLs and never display a credential-bearing remote URL.
- List "Handle" and detail "Handle with agent" share one task-creation flow.
  Read the complete item through the selected Host's IGitService, then open the
  existing WorkTaskEditor as a new-task draft with its title (200-character
  limit) and untrusted-source prompt prefilled. Keep the repository project
  fixed; expose the existing branch/worktree and API/ACP execution controls.
  The 20,000-character description boundary and source-link notice still apply.
- WorkTaskEditor owns the editable prompt, attachments, branch/worktree and
  execution draft. A new-task initial draft is separate from a persisted task;
  do not fabricate a historical WorkTask or inherit conversation history. The
  project preference is only an initial selection; the user can change it.
  Preserve exact API provider/model/options/mode or ACP agent/config. Validate
  the confirmed execution against the bound Host's current catalog before
  saving; an unavailable target reports an error without silently substituting
  another executor. Missing API configuration must not block choosing ACP.
- List rows share one subtle hover surface across the item and its action,
  with inset padding and rounded corners. Handle is a quiet ghost action with
  a task-add icon and readable text, always visible on touch and keyboard.
  Reserve space for the localized success label so saving does not displace
  the title or action. Success uses a check icon and success text at full opacity,
  retaining the disabled command. Use existing design tokens and button sizes;
  preserve wrapping and no horizontal overflow at 320px in both themes.
  At narrow widths, place the action below the content at the trailing edge
  so long titles and metadata retain the row's full reading width.
- Confirming Save calls the selected Host's IWorkTaskService.create with the
  exact workspacePath, workspaceIdentity and remoteSessionId. WorkTaskService
  remains the single owner of persistence and initial todo status. Opening,
  selecting and saving never start/queue a task, create an Agent conversation or
  worktree, change the main Agent, close an item, merge or write back to the forge.
  Cancellation creates nothing. Failed saves retain the editor's inputs for
  explicit retry. Success closes the editor, retains the list/detail, and shows
  "Added to To-do" on both entrypoints for the current repository content lifetime;
  this is transient feedback, not a durable forge-to-task mapping.
- Admit one item read/save at a time synchronously; repeated Handle clicks open
  only one editor, and repeated Save submits only one create command. Workspace,
  Host, remote or account changes discard the old draft and late reads; check
  ownership again after execution validation before dispatching create. An
  already dispatched save remains owned by its original Host/project and cannot
  close or mark a new project's editor. Desktop and mobile use the same save-only
  command; this change does not alter continuous/replayable session delivery.

### Handle acceptance cases

- List and detail both open the same prefilled new-task editor; opening and
  canceling issue no create/start/Agent commands.
- Change API provider/model/reasoning/mode or select an available ACP agent and
  config; Save retains the exact configuration and original issue title.
- With no preferred API selection, an available ACP can still be selected.
  If the chosen executor disappears before Save, create nothing and retain the
  draft with an actionable error; never fall back to a different executor.
- Double-click Handle/Save admits one operation. Detail/save failures can be
  explicitly retried; save errors preserve prompt/config. Cancel permits reopen.
- Switch project/Host/remote during read, with an open editor, during execution
  validation, or after save dispatch: stale reads never start a save; dispatched
  writes remain scoped to the original Host and never mark the new view.
- Preserve remote identity/session routing, keyboard access, both themes and
  usable 320px mobile layout. No conversation draft or forge write is created.

## Ownership And Boundaries

### Native issue creation

- The new-issue dialog provides a Markdown Write/Preview editor, labels,
  assignees and an open milestone, matching the supported forge create API.
  GitLab also provides confidentiality and a calendar due date. Unsupported
  fields are omitted. This increment does not implement issue templates,
  project boards or custom issue types.
- The dialog owns the unsent title, body and selected attributes. Catalogs are
  fresh, target-bound Host reads through getForgeIssueOptions. Read all bounded
  pages (100 pages, 100 rows per page), in parallel per section. Section errors
  are visible and retryable; unavailable fields are disabled, while title/body
  creation remains usable. Never silently truncate an attribute catalog.
- GitHub uses label names, assignee logins and milestone numbers; GitLab uses
  label names, member IDs and milestone IDs; Gitea uses label IDs, assignee
  logins and milestone IDs. Shared schemas validate bounded, unique selections
  and real calendar dates. Provider adapters reject unsupported attribute writes
  before HTTP. Selected attributes are included in the single create request;
  no follow-up edits or automatic write retries. Label selection only offers
  the existing catalog; this dialog has no new-label command.
- Opening or previewing a draft never writes remotely. Preview uses the existing
  safe web Markdown renderer and repository-relative links, without local file
  navigation or authenticated draft-image reads. Empty bodies have a localized
  placeholder. Keep keyboard, mobile-safe inputs, theme and locale support.

### New-issue images

- The draft editor accepts image files, pasted screenshots and dropped images.
  Accept PNG, JPEG, GIF and WebP, at most 4 MiB each and eight images per draft.
  Keep local thumbnails, uploading/failed/succeeded state, retry and removal.
  Block issue creation while any retained image is uploading or failed. Text
  remains editable during uploads; successful uploads append escaped Markdown
  to the latest body, never overwrite intervening edits. Preview local draft
  thumbnails without requiring an issue number or sending credentials to UI.
- UI/hook owns the unsent draft and files. Host IGitService owns target validation,
  upload admission and bounded request receipts. Bind each request to normalized
  workspace identity/path, repository, remote and account. Repeated identical
  request IDs within the same live Host join the same promise/receipt, including
  mobile reconnect; reuse with different bytes is rejected. No automatic retry
  of external writes. Explicit retry uses a new request ID. Host restart does not
  claim a completed upload was recovered. A still-mounted draft retains its file
  and requires explicit retry; an existing scope/connection owner reset disposes
  its draft, consistent with other repository drafts. This increment does not
  add persistent drafts or automatic reconnect resubmission. Removing a draft
  reference does not remotely delete an asset.
- GitLab uses the authenticated project Uploads API with multipart form data.
  GitHub.com Desktop uses its own new-issue webpage's file input, in an account-isolated
  sandboxed native window; verify the logged-in username before attaching bytes.
  Observe the webpage's completed Markdown value, validate the attachment URL,
  and close the window. Never submit the website's issue form. No copied browser
  cookies, hardcoded upload-policy endpoints, token-to-cookie conversion, or
  third-party image hosting. Missing/changed webpage controls fail explicitly.
  Login/cancel/account mismatch and upload failures preserve the client draft.
  GitHub identity has three distinct states: a missing identity marker is not yet
  confirmed (observe marker insertion/content changes); an explicitly empty marker
  means sign-in is needed; only a nonempty different username is account mismatch.
  An unresolved marker at the existing page-readiness deadline reports sign-in
  needed, never account mismatch. Verified identity with unavailable upload
  controls still reports upload unavailable. Never attach bytes before identity
  matches. Authentication pages receive no upload script or image bytes.
  Before any file is attached, the native upload owner may recover once by opening
  GitHub `/login` with a return target of the same repository's `/issues/new` in
  the same native window (title identifies the expected GitHub username).
  On confirmed mismatch, clear only this feature's isolated session before this
  sign-in recovery; unknown/unsigned identity must not clear storage. A second
  auth/mismatch failure is returned to the retained draft; no login loop or
  automatic retry of an upload that may have already written an attachment.
  GitLab's partition and the user's browser profile are never touched.
  Exhausted GitHub sign-in recovery has its own localized draft error asking
  the user to retry GitHub sign-in; do not label it account mismatch or a
  generic server response error.
- Native account windows apply the existing Desktop HTTP proxy/domain-selection
  policy before navigation. Network settings are shared while cookies stay
  isolated; these windows keep strict TLS verification. See `network-proxy.md`.
- The native upload transport is a port behind Host, not UI or task state in Main.
  Extend the strict existing Host native-media protocol with typed upload request
  and result variants. Tokens/cookies stay on Host/Main; native replies contain
  only validated image URLs. Validate file signatures, actual byte counts,
  filename and returned URLs on Host as well as native context on Main.
- Standalone Web/server Hosts without a native GitHub upload port report that
  capability unavailable. Gitea pre-creation image upload is explicitly unsupported
  until a compatible server API is implemented. UI shows the reason and an
  existing repository webpage link; do not silently create an issue to attach files.
- Desktop and mobile remote use the same scoped Host command/receipt; existing
  desktop-continuous and web-remote-replayable transports remain unchanged. On
  project/Host/account switch or dialog disposal, late replies cannot affect a
  new draft. Switching to Settings retains the same mounted draft/upload state.

```text
choose/paste/drop -> UI draft(file + request ID) -> Host validate/admit
  -> GitLab multipart / GitHub native account window -> validated attachment URL
  -> Host receipt -> same live draft appends Markdown -> user create -> existing createForgeIssue
reconnect -> identical request ID -> same Host receipt; new draft -> old response ignored
GitHub page -> identity pending/signed out -> native login (once) -> same target
            -> confirmed wrong user -> clear only GitHub upload partition -> login (once)
            -> matching user + controls ready -> attach exactly once -> receipt
```

Acceptance: missing/empty/delayed identity marker never reports mismatch or
dispatches files; content attribute hydration resumes the same script; a known
different user is rejected before attachment; real Electron synthetic login
navigation returns to the same repository, keeps GitLab cookies untouched,
recovers once in the same window, and preserves cancellation/parent-close and
the no-website-create guards. Exhausted recovery/unknown upload results fail
without another file dispatch.

Acceptance: service tests cover multipart, invalid bytes/URL, target changes,
duplicate request admission and unsupported Hosts. Native protocol and synthetic
browser tests cover username mismatch, completed value, failed/changed DOM,
cancel/disposal and no website issue submission. Editor E2E covers selection,
paste/drop, retained concurrent text edits, failure/retry/removal, creation gate,
late replies after switching, settings retention, mobile and both themes.
Synthetic tests are not proof of a real GitHub/GitLab upload; report live-provider
validation separately.

- The description editor has a visible input border and surface at rest, with
  a focus treatment inside the same boundary. Attribute multi-select triggers
  show a chevron and a localized selection prompt. Labels show native color
  dots in both the menu and the selected projection below the trigger; clicking
  an already checked label removes it. Reuse RepositoryLabels for that projection.
- Catalog reads follow dialog visibility, workspace identity, Host, remote and
  account. Old replies never populate another target. Settings coverage preserves
  drafts, pauses reads and reloads catalogs on return. Write admission remains
  useForgeMutation; failure retains the complete draft and selections.

```text
dialog draft -> workspace hook -> target revalidation -> one provider POST
dialog visible -> bound Host -> parallel paged catalogs -> guarded UI projection
covered/old target reply -> ignored; explicit retry -> fresh read, never create
```

- Validation: provider endpoints/pagination and exact write payloads, unsupported
  fields and invalid dates rejected before IO, section permission errors,
  stale target rejection; E2E Write/Preview, attribute selection, failed-create
  draft retention, settings/Host switches and narrow-screen containment.

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
list/detail Handle -> bound Host full-item read -> new WorkTaskEditor draft
            -> explicit API/ACP selection -> confirmed Save
            -> execution validation + current-owner check -> same Host IWorkTaskService.create
            -> persisted todo -> existing task events/read model
            -> matching row's transient success feedback
scope change before save -> discard old read (no create)
scope change after save admission -> original Host persists; ignore old UI reply
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

- Unit: project/remote restoration after store recreation, trimmed identity/path
  fallback, same-path isolation, reconnect stability, compare-and-clear for
  removed remotes, malformed and blocked storage.
- E2E: remote survives project switching and back/forward, panel remount and page
  reload; sidebar entry restores the remembered project after conversation
  navigation. Explicit targets win; missing/disconnected remembered projects
  fall back without cross-identity activation. Removed remotes rediscover the
  Host default, stale replies cannot overwrite newer selections. Creating an
  issue uses the remembered remote only after explicit submission. Preserve
  task/composer drafts and cover narrow/light/dark layouts.

- E2E: list/detail Handle opens a prefilled task editor and confirmed Save saves a todo task with full detail content and exact
  project scope, leaving the list visible and producing no agent/forge writes.
  Cover double-click admission, save/read failures and explicit retry, preferred
  API and remembered ACP configurations, missing model, same-path remote
  identity, stale detail replies after project/remote changes, and a save already
  dispatched before switching projects. Check keyboard access, narrow layout,
  light/dark themes and success feedback.

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
  task editor selection and cancellation, delayed old replies after workspace/remote changes,
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
