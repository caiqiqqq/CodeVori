# Multi-Agent Collaboration Settings

## Behavior

The multi-agent collaboration settings page is temporarily unavailable. The settings sidebar must not list the `delegation` section, and any saved section preference or one-time navigation intent targeting `delegation` must resolve to the existing `general` fallback.

## Ownership and boundaries

`packages/ui/src/lib/settingsNavigation.ts` owns whether a settings section is navigable. `settingsPageConfig.ts` derives the visible sidebar from that decision, while `SettingsPage.tsx` renders the selected section. This change only removes the settings surface; delegation services, persisted settings, existing task results, and their session UI remain owned by their current modules and are unchanged.

## Acceptance scenarios

- Web and desktop settings configurations omit the `delegation` section and its sidebar entry.
- `isSettingsSectionEnabled("delegation")` returns false, and resolving that section returns the caller's fallback (defaulting to `general`).
- An old persisted `delegation` preference opens `general` rather than mounting the removed page.
- Other settings sections remain available.
