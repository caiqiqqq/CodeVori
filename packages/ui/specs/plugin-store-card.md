# Plugin Store Card

## Behavior

- Store cards present one plugin listing in public, personal, and search result groups.
- Opening the card body navigates to that listing's detail view by its stable plugin ID.
- The card keeps the listing icon, localized display name and description, update state, and missing-source warning visible when present.
- Uninstalled listings retain the install or restore action. Installed listings retain update and item-menu actions; these controls do not trigger card navigation.
- Each card is a compact horizontal unit: a 40px listing icon, flexible localized identity text, and trailing actions.
- A subtle card surface and border distinguish each listing from the page while hover and keyboard focus remain visible.
- Card presentation is responsive to the available grid width and uses semantic theme tokens and the UI typography scale.

## Ownership and invariants

- `PluginStorePage` and `pluginManagementStore` remain the owners of loaded listing and operation state.
- `PluginStoreCard` is a presentation and command-dispatch component. It does not duplicate installation state or introduce another persistence path.
- `PluginStoreActions` remains the sole UI command contract for opening, installing, updating, enabling, resetting, and uninstalling a listing.
- The list view continues to own grouping, sorting, and responsive grid placement.

## Acceptance scenarios

- A public, personal, or search listing renders the same card presentation for the same item state.
- Long names and descriptions do not push action controls outside the card or overlap adjacent content at narrow widths.
- Update and source-missing indicators remain legible alongside long localized names.
- Clicking or keyboard-activating the card body opens the matching detail; activating an inner action performs only that action.
- Light and dark themes preserve readable text, card boundaries, focus indication, and hover state through semantic tokens.
