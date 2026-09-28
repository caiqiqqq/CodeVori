# Desktop startup without login

## Behavior

- Desktop starts in the workspace even when no app account or usable model provider is configured. The first-run occupation and UI preference onboarding remains unchanged.
- A previously cached account is still restored in the background. If its cached session requires reauthentication, clear the stale user but do not show a startup reauthentication dialog or the WelcomeScreen.
- A JWT-invalid restart marker is consumed on Desktop without reopening the WelcomeScreen. Web retains its existing startup login behavior.
- Manual account login and model provider/API Key setup remain available. No local user, token, provider family, or usable model is fabricated merely to enter the workspace. Model-backed actions still require a valid provider connection.
- Web, server authentication, remote pairing, and CLI behavior are unchanged.

## Ownership and order

```text
Desktop Root -> cached OAuth restore (OAuth service) -> user projection
             -> provider settings hydration -> tab restore / fallback workspace
             -> workspace shell (regardless of account/provider availability)

Manual login -> WelcomeScreen -> OAuth service / provider settings -> user/provider projection
Web startup -> existing provider guard and reauthentication behavior
```

Root owns the startup surface decision, the OAuth service owns cached credentials, and provider settings own model availability. A failed provider read must finish the loading gate without being treated as an empty credential or a successful login. No migration or persistence write is needed for an anonymous Desktop launch.

## Acceptance

1. Fresh Desktop data directory, no account and no model: complete the existing onboarding and reach a workspace without seeing the login page. Opening Settings still permits model/API Key configuration.
2. Desktop with a cached session requiring reauthentication: clear the stale account and reach the workspace without a reauthentication dialog or login page.
3. Desktop restarted after a JWT-invalid marker: consume the marker and reach the workspace; a later restart must not resurrect it.
4. Web with no usable provider and Web with an expired cached session: preserve their current login prompts.
5. Manually requested login on Desktop still opens and completes the existing login flow. No server, remote, or model request is granted without its real credentials.
