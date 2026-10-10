# Conversation visualizations

## Behavior and ownership

API and ACP assistant text use the same `MessageResponse` visualization projection.
Recognize the complete `visualize{"path":"…html","mode":"wide","title":"…"}`
reference on its own line. `path` is required; mode defaults to normal and title is
optional. Code fences, inline code, user messages, external documents and shared
read-only conversations never execute references. Invalid references remain text;
an unfinished streaming reference is withheld until it closes. Surrounding Markdown
retains the existing renderer. Multiple references remain in source order.
Paths inside recognized references do not generate duplicate ordinary HTML file cards.

The existing Host transcript remains authoritative; no protocol or persistence
migration is required. The UI derives references from both live and restored text.
The shared visualization component owns only its read result and frame height.
It does not submit prompts, tools, tasks, or widget state to the Agent.

Resolve services using the explicit pane workspace identity/path and remote session,
including the existing disconnected guard. Files must be HTML inside the canonical
workspace root, including after resolving symlinks. Read at most 1 MB using bounded
async file-service IO. Missing, non-UTF-8, empty, oversized and out-of-workspace files
show a localized retryable error; never display a truncated executable fragment.

HTML executes only in a `srcdoc` iframe with `sandbox="allow-scripts"`, without
same-origin, navigation, popup or form permissions. A restrictive CSP blocks network
connections, nested frames and objects; static resources may use the visualization
CDN allowlist. The frame supplies theme variables, basic visualization styles and
Lucide placeholders. It has no app/service bridge. Height messages are accepted
only from that iframe's current window and are bounded. Normal/wide width adapts to
the available pane, including mobile. Theme changes recreate the frame document.

## Event order and recovery

```text
API runtime / ACP Host → existing assistant text projection → MessageResponse
desktop-continuous live text ────────────────────────────┤
web-remote-replayable restored text ─────────────────────┘
  → complete reference → explicit workspace service resolver → canonical file read
  → current scope result → isolated frame → source-checked bounded height projection
```

The read key includes workspaceIdentity.trim() || workspacePath, remote session,
service instance, file path and conversation session. Cleanup invalidates pending
reads. Switching scope, disconnecting or reconnecting cannot show a previous Host's
content, even when file paths match. Retry increments only the local read generation.
No added queue, snapshot owner, timer-based synchronization or filesystem watcher.

## Acceptance

1. The same reference in API and ACP rows produces an interactive frame with the
   same Markdown before/after it. Complete streaming and restored snapshots agree.
2. Every streaming prefix remains non-executable; completion creates one frame.
   Code examples and malformed references stay visible and never read files.
3. Normal/wide frames fit desktop and 375px mobile in light/dark themes; local
   buttons work and height updates do not overflow the conversation pane.
4. Two remote identities with identical paths read their own service; disconnect
   never falls back to local services; late reads cannot replace a newer scope.
5. Missing, oversized, invalid UTF-8, traversal and symlink-escape files fail visibly.
   Retry recovers after the current Host supplies the file.
6. Frame code cannot access parent DOM/services or perform network IO. Spoofed
   height messages do not affect another frame; non-finite heights are ignored.

Unit validation covers parsing, bounded reads and frame construction. Browser E2E
uses real shared messages and synthetic API/ACP rows, without model requests, and
checks interaction, isolation, themes, mobile and stale remote reads.
