# Model Settings Menu

## Behavior

The settings sidebar exposes one `模型设置` entry for the model provider settings and Agent SDK (ACP) management pages. Inside that entry, a segmented tab control switches between the two existing pages. Selecting either tab keeps the shared sidebar entry active and preserves the existing page content and controls.

## Ownership and boundaries

- `SettingsPage` owns the selected settings section and therefore the selected tab. It remains the only navigation state owner; no second tab store or persistence path is added.
- `settingsPageConfig` exposes the model provider section as the single sidebar entry. The ACP section remains in the section metadata for direct navigation and is omitted only from sidebar groups.
- `ModelProviderSection` continues to use the injected local Host services and owns model-provider interactions. `AcpAgentsSection` continues to use the active workspace/remote Host target and owns ACP interactions.
- The tab control is presentation and navigation only. It does not move provider or ACP settings between owners or change their persistence.

## Compatibility and failure behavior

- Existing navigation intents for `modelProvider` and `acpAgents` continue to resolve to their corresponding content tabs.
- Existing remembered `acpAgents` selection remains valid even though there is no separate sidebar item.
- Platform-specific section resolution continues to treat ACP management as available wherever it is currently rendered.
- Tab changes are synchronous UI navigation; if a target section is unavailable on a platform, existing platform fallback behavior applies.

## Acceptance scenarios

1. Desktop and Web settings navigation contain exactly one model settings sidebar entry and no separate Agent SDK management entry.
2. Opening the model settings entry shows the existing model provider settings by default.
3. Switching to Agent SDK management shows the existing ACP management page while the model settings sidebar entry remains selected.
4. Switching back shows the existing model provider page and its persisted configuration.
5. A direct `acpAgents` settings intent opens the Agent SDK tab, and a direct `modelProvider` intent opens the model provider tab.
6. Existing delegation and ACP navigation flows continue to work on desktop and Web.
