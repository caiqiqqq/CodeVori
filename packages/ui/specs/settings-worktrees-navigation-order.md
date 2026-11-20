# Settings Worktrees Navigation Order

## Behavior

The Worktrees settings entry appears immediately after Archived Conversations in the settings sidebar. Both entries belong to the Data and Statistics group so the rendered navigation order matches the product request on Web and Desktop.

## Ownership and interface

`packages/ui/src/settings/settingsPageConfig.ts` owns the static settings section order and group assignment. The sidebar consumes the derived `settingsSectionGroups`; no separate ordering state or navigation route is introduced.

## Acceptance

- The Data and Statistics group contains Archived Conversations followed immediately by Worktrees.
- The order remains the same across Web, macOS Desktop, Windows Desktop, and Desktop configurations.
- Existing Worktrees navigation and section resolution continue to work.
