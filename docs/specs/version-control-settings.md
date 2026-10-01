# Version Control Settings

## Product Rules

- Settings adds Version Control beside Worktrees. The page uses existing settings
  typography, controls, themes and responsive layout, not a second Git workspace.
- Match Codeg's Git executable detection/custom path and separate GitHub, GitLab,
  Gitea/Forgejo and generic Git account groups. Provider is explicit; a self-hosted
  GitLab must never be inferred to be GitHub Enterprise.
- GitHub add-account and update-credential dialogs do not show a recommended
  permissions hint in any locale. Keep token generation, credential validation
  and other providers' hints unchanged. This is presentation-only; configuration
  ownership and public service contracts are unchanged.
- A nonempty custom Git path must be an absolute, executable Git binary whose
  `--version` output is valid. Empty restores automatic discovery. Save on blur;
  invalid paths leave the saved configuration untouched. New Git commands,
  including checkpoint/worktree operations, read the accepted path. In-flight
  commands keep their original binary.
- Git discovery resolves a command name against the same command environment
  used by Git operations and returns the absolute executable path, never just
  `git`. Preserve candidate priority, executable checks and per-provider caching
  on macOS, Linux and Windows. Under the detected version, show `Path: <path>`;
  custom paths appear there after validation, and clearing one restores the
  detected installation path without saving it as a custom override.
- Forge accounts are validated against their own user API before adding/rotating.
  GitHub public uses api.github.com, Enterprise uses /api/v3; GitLab /api/v4;
  Gitea/Forgejo /api/v1. No credential-bearing redirects. Timeouts are bounded.
  Host assembly injects the existing HTTP transport, honoring configured proxy,
  bypass rules and custom CA settings without adding application API credentials.
- Generic accounts require server, username and password/token. Their credential
  test only confirms storage availability, never claims server connectivity.
- The first account is default; setting another default clears the previous one.
  Removal promotes the first remaining account when necessary. Rotation preserves
  account ID, server, provider, default status and creation date; it rejects a
  token belonging to a different username. Failed operations preserve old state.
- Secrets never return in settings/test responses, enter logs or command-line
  arguments, or go into ordinary settings/localStorage. Use the existing Host
  credential cipher and atomic private credential storage.
- Saved accounts supply per-command HTTP(S) Git credentials for ZCode's own Git
  push operations. Exact protocol, host, port, base path and optional username
  determine matching; default wins among matching accounts. SSH and unmatched
  servers retain their existing authentication. Do not modify global/repository
  credential helpers. This does not configure independent ACP agent subprocesses.

## Ownership And Event Order

The local/attached Host IGitService owns version-control configuration. Settings
uses localHostServices, even when a remote workspace tab is active, consistent
with local model/worktree settings. A remote Host's Git operations use its own
configuration. No task queue, owner/lease or conversation stream changes.

```text
input -> settings hook -> IGitService -> validation -> private repository lock
                                                   -> encrypted atomic save
                                                   -> public settings response
Git command/checkpoint -> same private repository -> path + credential helper
Git discovery -> command environment + candidate priority -> absolute path
                                                         -> command / settings
```

- One encrypted configuration record contains metadata and secrets; no partial
  metadata/token commits. A cross-process lock covers read-modify-write. No IO in
  shared schemas or UI. Network validation occurs before lock admission.
- Account mutations re-read current state inside the lock. Rotation checks the
  original secret again, rejecting stale concurrent replacement/removal. Tests
  are read-only. Refreshes never overwrite unsaved input. UI ignores responses
  after Host change/unmount; double submits are blocked while admitted work runs.
- Desktop continuous and mobile replayable conversation semantics are unchanged;
  settings are request/response snapshots, freshly read on page entry/refresh.
- No Codeg credential migration or app-update behavior is introduced.

## Public Contract Example

```ts
await gitService.updateGitPath({ path: "" }); // automatic discovery
await gitService.addGitAccount({
  provider: "gitlab",
  serverUrl: "https://gitlab.example.invalid",
  secret: "<entered token>",
}); // validated and atomically stored; returns public metadata only
await gitService.testGitAccount({ accountId }); // never returns the saved token
```

## Acceptance

- Unit tests: provider-specific URLs/headers/scopes, URL/redirect rejection,
  failures, public secret stripping, persistence failure preservation, concurrent
  writes, default/delete/rotation identity, path validation/live path changes,
  credential matching and a real helper round trip without external requests.
- E2E: four account sections, empty/loading/error states, add/test/default/rotate/
  remove confirmation, invalid path/retry, save on blur, page revisit, stale Host
  replies, mobile and dark/light layout without horizontal overflow. Use fake
  Hosts and synthetic credentials only; never mutate a real code-hosting account.
- E2E: GitHub add/update dialogs omit the permissions hint while retaining the
  masked credential field, token-generation link and existing submit behavior.
- Unit/E2E: automatic Git detection returns an absolute path; PATH ordering,
  paths containing spaces, invalid candidates and provider caching are preserved.
  The localized path label stays visible after refresh, custom-path save/reset
  and on narrow screens without overwriting the input's automatic mode.
- Run focused Git tests, typecheck, lint and changed-file architecture check.
