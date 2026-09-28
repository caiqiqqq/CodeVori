# Model settings: custom provider navigation

## Product rule

The Model Settings sidebar displays only custom model providers. The former built-in “智谱 / Providers” group and its BigModel and Start Plan entries do not appear in this settings view. Existing custom providers remain selectable and sortable, and the Add Provider action stays available. This is a presentation change; existing API Provider, Codex/Claude ACP and ZCode session configuration and runtime data are not deleted or rewritten.

## Ownership and interface

`useModelProviderNavigation` owns the sidebar projection and selected node correction. It exposes only custom providers as sidebar groups; other provider facts remain in the existing model service and are not mutated. On opening the settings page or receiving an old built-in selection, select the first visible custom provider. Preserve a valid custom selection when the list refreshes. If there is no custom provider, selection becomes null and the detail area shows the existing empty-provider message. The header's Add Provider action opens the existing template picker and creating a provider selects it once the provider snapshot contains it. No protocol, persistence format or Host service changes.

```text
Host provider snapshot → model settings navigation projection → visible custom sidebar
                                           ↓
old/invisible selection → first custom provider or null → detail/empty state
Add Provider → existing creation service → refreshed snapshot → select created custom provider
```

## Acceptance

1. Open Model Settings with built-in and custom providers. No “智谱 / Providers”, BigModel or Start Plan sidebar entry appears; the first custom provider's detail is shown. Switching between custom entries and reordering still works.
2. An old built-in selection or settings deep link cannot leave an invisible selected row or display its built-in detail; the first custom entry becomes selected. Refresh and language changes preserve a valid custom selection.
3. With zero custom providers, the settings view shows the existing empty-provider message and Add Provider. Create one through the existing flow; its detail becomes selected. Returning to the composer still offers the configured API models and both ACP Agents.
4. On desktop and narrow/mobile Web, the custom navigation, empty state, and Add Provider remain accessible in light and dark themes. Switching English and Chinese does not restore the built-in group.

The interaction E2E scenario opens the desktop Model Settings page, checks both the navigation and selected detail, creates or selects a custom provider, refreshes, then returns to the composer to confirm API and ACP target choices. Repeat the navigation and empty-state checks with a narrow viewport; this checkout does not provide a unified E2E runner, so verify the running desktop UI manually.
