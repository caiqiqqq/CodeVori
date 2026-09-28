# Sidebar account actions

## Behavior

- Both workspace and settings footers hide the profile trigger and its quick menu. The workspace gear still opens Settings; the settings footer button still returns to the workspace.
- Settings keeps its sections, including language, theme, interface mode, model configuration, and usage statistics. Desktop zoom remains available through the application View menu and keyboard shortcuts.
- Model settings retain account connection and API Key configuration; the separate missing-model chat banner is covered by `hide-missing-model-banner.md`.
- This is a presentation change only. OAuth credentials, provider selection, entitlement checks, purchase flows on other surfaces, server authentication, and remote pairing are unchanged.

## Ownership and acceptance

`WorkspaceSidebarFooter` owns whether its profile menu is rendered, as directed by `WorkspaceSidebar` and `SettingsPage`. Usage entitlement state remains with `useWorkspaceSidebarFooterUsageSummaryState`, whose entitlement and product reads are disabled for a hidden menu. Settings state and persistence are unchanged; there is no new state or migration. No additional account or provider authorization behavior changes.

1. In a signed-out desktop workspace, the footer has no profile trigger or menu; the settings gear remains at the right and opens Settings.
2. In Settings, the profile trigger is also absent, while the back button and settings navigation remain usable.
3. Language, theme, interface mode, model configuration, and usage statistics still work; desktop zoom works via the native View menu and shortcuts. OAuth/provider data and send admission remain unchanged.
