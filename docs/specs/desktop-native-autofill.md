# Desktop native autofill lifecycle

Desktop's Electron runtime owns native datalist/autofill popups. Repository
upload/login windows remain account-isolated, sandboxed BrowserWindows; their
Main owner handles navigation and disposal, while Host retains upload admission
and receipts. The UI must not retain native popup state.

On macOS, an autofill request can arrive while its parent window/native view is
being disposed. The runtime must ignore such a popup instead of dereferencing
an invalid parent and crashing the whole application. Use Electron's upstream
native-view/closed-widget checks; do not use arbitrary disposal delays, disable
typing or alter user text to suppress suggestions.

Pin Desktop to Electron 41.10.7 (same major as 41.0.3), including the upstream
autofill teardown fix electron/electron#51321 and the empty-suggestion popup fix
#52320. Keep the lockfile and installed runtime aligned. The package manifest
owns the exact version pin; electron-builder must read the installed package's
version instead of keeping a second literal that can ship the old runtime.
Acceptance checks both the installed runtime and production bundle config
against that pin. No new application
protocol, state owner, dependency direction or Desktop/mobile delivery semantics
are introduced.

```text
renderer field/datalist -> Electron AutofillDriver -> native popup
window owner disposes -> native parent view unavailable
                     -> Electron rejects late popup -> app continues
Host upload receipt/abort -> existing draft result, no automatic retry
```

Acceptance:

- Real Electron synthetic page: datalist suggestions remain selectable using
  the keyboard; the selected value is correct.
- Repeated native parent/child teardown while input requests a popup must not
  terminate the Electron process or leave child windows behind. Cover both
  direct child destruction and parent close.
- Existing GitHub native upload/login/hydration/cancel and GitLab native media
  tests pass on the pinned runtime. Root typecheck, lint and architecture checks
  report actual results.
- Crash symbolication must use the exact Electron module UUID. Record the
  resolved native stack separately from inferred application trigger timing.
  Synthetic stress success is not proof of a real GitHub upload or proof that
  every unrelated application crash has been eliminated.
