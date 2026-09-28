# Disable app onboarding

## Behavior

- The app opens its workspace or settings surface without the first-run occupation/preferences guide, including on a fresh local profile.
- Settings no longer offers a manual entry to that guide in its sidebar or General section. The follow-on onboarding migration wizard is not mounted because its only entry is the removed guide.
- Existing settings, provider configuration, standalone import actions, and macOS Computer Use permission assistance remain available. The web sign-in screen is not part of this change.

## Ownership and boundary

`Root` owns whether the app-level onboarding surfaces are mounted. The settings page owns the former manual entry points. No onboarding record is written or erased; existing preferences and imported data are left untouched. The default interface mode and preferences continue to come from their current settings/store owners.

## Acceptance

1. A fresh desktop profile reaches the workspace without an occupation guide or migration wizard.
2. Settings has no onboarding button in the sidebar or General section.
3. Returning to the workspace and reopening settings do not resurrect onboarding; model configuration and ordinary settings still work.
