# Hide missing-model chat banner

## Behavior

- A draft with no configured model does not show the "no available model" chat error banner, including its Upgrade and Configure buttons.
- Model readiness admission still prevents sending to an unavailable provider; this is not a credential, entitlement, or provider bypass. Users can configure a model through the existing model manager and Settings.
- Other chat errors, including current runtime failures and historical-model errors not already suppressed, retain their existing banners and actions.

## Ownership and boundary

`useDraftModelReadinessGate` remains the single owner of model readiness and send admission. `ChatErrorBanner` owns the presentation decision for structured missing-model errors; the composer consumes that decision for rendering and visibility telemetry. No persisted data, protocols, or server behavior change.

## Acceptance

1. A signed-out fresh desktop workspace with an empty model registry shows the composer and model manager without the highlighted banner.
2. Trying to send with no model remains blocked by the existing readiness gate; configuring a usable model still enables the normal path.
3. Other error codes are not newly suppressed.
