# Network proxy domain selection

## Product rules

- AppSettings remains the only persisted owner of the explicit HTTP proxy,
  `httpProxyOnlyDomains` and No Proxy configuration. The Settings network card
  adds “Only these domains use the proxy”. Empty preserves existing all-target
  proxy behavior. Without an explicit proxy, the domain list has no effect.
- Accept comma/newline separated hostnames and `*.example.com` wildcard rules.
  Bare hostnames match exactly; wildcards match subdomains, not the apex. Match
  case-insensitively after IDNA normalization and removing a trailing dot. Never
  use substring matching. Reject URLs, ports, paths, arbitrary wildcards, empty
  segments, and more than 64 rules. Normalize and deduplicate before saving.
- With a nonempty list, unmatched HTTP(S) targets go directly. No Proxy wins
  over matching allowlist rules. Existing No Proxy syntax remains supported.
  Clearing the field must send an empty string through RPC and remove the old
  persisted field. Apply changes after restarting app/Agent, like proxy settings.
- This config changes application-controlled HTTP(S) egress, not system settings
  or arbitrary raw sockets. Tools must honor HTTP_PROXY/HTTPS_PROXY to participate.
  Browser extensions and external browser profiles are not imported.

## Owners, interfaces and delivery

- Shared exports own pure normalization/matching. Strict AppSettings read/update
  schemas validate the new optional string. SettingsService owns persistence;
  UI owns only the unsaved field and uses its existing settings service path.
- HostApiNetworkTransport selects each request route. Its subprocess proxy URL
  port lazily creates a loopback-only HTTP/CONNECT router when a selective policy
  is needed. Router options are immutable per Agent launch configuration, reused
  for identical settings and owned/disposed by the same Host transport. Keep old
  launch routers alive until Host disposal (at most 32 distinct policies); do not mutate a running Agent policy.
  No bytes/TLS credentials are inspected inside CONNECT tunnels. HTTP(S) upstream
  proxies and existing custom CA work; proxy failures never retry directly.
- Agent spawn injects this router into the existing standard and ZCode proxy
  environment variables, so CLI/model/MCP/subprocess adapters retain one existing
  env path. Remote WSL authority also carries domain rules and creates its router
  on the remote Host, never passes a desktop loopback URL to a remote process.
  SSH/Docker retain their existing independent settings ownership.
- Desktop Main owns the startup Chromium settings snapshot. Shared domain rules
  generate a PAC when selection is enabled; all other proxy behavior stays on
  the existing Session policy. Native GitHub/GitLab account partitions apply this
  same network policy before opening a page, keeping cookies isolated and strict
  TLS verification (no embedded-browser insecure-certificate opt-in).
- Desktop continuous and mobile replayable settings commands use their existing
  owner/routing; this feature adds no session/queue state or auto retry.

```mermaid
sequenceDiagram
  participant UI as Settings draft
  participant S as SettingsService owner
  participant H as Host transport
  participant M as Main Session policy
  participant A as Agent/tool
  UI->>S: save normalized domains (empty clears)
  Note over S,M: restart applies a new configuration snapshot
  S->>H: proxy + domains + bypass
  S->>M: same policy
  H->>A: existing proxy env (loopback router for selective rules)
  A->>H: HTTP request / CONNECT target
  H->>H: bypass first, domain selection second
  M->>M: configure isolated Session before navigation
  Note over H,M: matching target -> proxy; unmatched -> direct
```

## Acceptance

- Unit: IDNA/case/trailing dot, exact/wildcard boundaries, malformed and oversized
  input; read/update validation, persistence clear, no-proxy precedence, no proxy
  configured and backward compatibility.
- Network: local fake upstream and origin prove HTTP and CONNECT matching uses
  proxy, unmatched/bypassed direct, redirects reselect routes, failed proxy no direct fallback, router reuse,
  disposal and startup/disposal races.
- Chromium: actual Electron Session PAC resolution for match/unmatch/bypass;
  native upload policy awaited before navigation and strict TLS remains enabled.
- UI E2E: save/reload/clear, invalid input prevents save, both languages/themes,
  desktop and narrow mobile. Existing settings persistence routes remain intact.
- Execute root typecheck/lint, changed architecture and targeted tests. Synthetic
  routing tests do not prove live GitHub login/upload through a user's proxy.
