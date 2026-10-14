# ACP task completion notifications

ACP turns use the existing task notification and notification sound preferences,
localized copy and `IPlatformService.showTaskNotification`. There is no new Host
state, protocol event or background Agent.

## Notification focus preference

General settings adds “仅在窗口无焦点时通知” / “Notify only when unfocused” next to
the task notification controls. It defaults to enabled, including for existing
installations with no stored value. Enabled keeps the current behavior: Desktop
suppresses a notification when any app window has focus; Web suppresses it when
the current document has focus. Disabled allows notifications in both foreground
and background. OS/browser notification permissions still apply.

The existing UI notification preference store owns this boolean and persists it
in localStorage alongside the notification and sound preferences. It is local to
the client, not a Host/workspace setting. Changing it affects the next notification
immediately, without restart, listener remount or replay of earlier notifications.
The notification master switch disables this control while retaining its value.
The sound preference remains independent and cannot bypass the master switch.

```text
settings toggle → UI store + localStorage (single preference owner)
live notification edge → platform adapter reads preference at send time
                       → Desktop IPC onlyWhenUnfocused (optional boolean)
                       → Main checks all app windows → native notification → sound
                       → Web checks document focus → browser notification → sound
```

`TaskNotificationPayload.onlyWhenUnfocused` carries the policy to Desktop Main;
missing values preserve focus suppression for older callers. IPC rejects non-boolean
values. Main owns the actual window focus check and does not persist the preference.
All existing native/API, ACP, work-task, permission and feedback notifications use
the same platform path. Notification deduplication, routing and replay boundaries
are unchanged; losing focus or changing this setting never resends old events.

Acceptance: test both switch positions with focused/unfocused windows, an additional
focused app window, default/missing and invalid IPC values, reload persistence,
master-switch disabling with value retention, and unchanged deduplication. Exercise
the production settings row/store and Desktop adapter at desktop/mobile widths in
both themes and languages. Synthetic IPC/browser tests do not prove native OS banner
display, browser notification support on mobile, or audible speaker output.

## Ownership and delivery

The target Host remains the sole owner of `AcpSession`, revision, errors and queue.
One workspace-level renderer hook observes `IAcpService.onDynamicSessionChanged`,
independent of the selected pane/Agent. It retains only small revision/status facts
and navigation targets for notifications it emitted, not transcripts or a queue.
The exact scope includes workspace identity (with local path fallback), filesystem
path, attachment id and service instance. Disable, disconnect or a changed scope
disposes the listener and invalidates in-flight reads and callbacks.

```text
ACP turn → Host snapshot persistence → increasing scoped revision
                                      → renderer observed running → terminal edge
                                      → shared notification preference
                                      → platform notification → shared sound preference
desktop: continuous live events ────────────────┘
mobile: initial/reconnect snapshot → baseline only; no historical notifications
```

Subscribe before listing. Initial/list snapshots only seed or advance the baseline;
they never emit notifications or overwrite newer live revisions. The first live
snapshot of an unknown session is also a baseline. A subsequently observed live
`running → idle` transition emits completed, unless the queue reports an explicit
stop/error. An observed running turn ending with an error emits failed. Explicit
stop without an error does not emit success. Repeated/older revisions, streaming
updates, metadata edits, provisional/superseded/archived sessions, deleted sessions
and events from another workspace do not notify. A new running turn can notify
again when it ends. Live edges observed while the initial read is pending remain
eligible; the late read must not undo them.

Notifications use `acp:<Host session id>` as their platform notification identifier,
so native task routing never treats an ACP id as a native task. Desktop clicks reuse
the existing ACP conversation navigation intent with the exact workspace identity,
path and current attachment. Deleted/archived targets and stale callbacks do not
navigate. Platform focus suppression, native deduplication and browser permission
requirements remain authoritative. Sound only plays through the existing platform
notification acknowledgement and respects both existing preferences.

## Acceptance

1. API notifications retain their existing terminal-phase behavior.
2. Background ACP sessions of any Agent emit one localized completed notification
   for an observed successful turn, including when another Agent/pane is selected.
3. Failed turns emit failed; explicit stop, duplicate/stale revisions, metadata and
   stream updates emit none. A subsequent successful turn can emit again.
4. Enabling notifications, opening history, remounting or reconnecting desktop/mobile
   to an already completed snapshot emits none. Disabled/disconnected scopes cannot
   receive notifications; enabling/reconnecting re-establishes a baseline.
5. A delayed initial read cannot overwrite live revisions; removed sessions cannot
   be revived by a delayed read/event. Same path with different identity is isolated.
6. Desktop and narrow/mobile Web use the same hook and platform payload. Notification
   and sound preferences are independently exercised; no sound when either is off.
7. Clicking an ACP notification issues the existing ACP navigation intent for its
   exact session and attachment without selecting a native task.

Validation: pure transition tests and a browser fixture mounting the production
hook/settings store with an eventful fake service and captured platform commands.
These tests do not prove OS permission, banner display or audible speaker output.
