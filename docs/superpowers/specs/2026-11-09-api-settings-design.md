# API Settings and Interactive Documentation

## Agreed behavior

Add a Settings dialog accessible from the workspace and **KVM Workspace →
Settings…**, using the macOS Command-comma shortcut. Follow the existing native
HTML dialog and preload/IPC patterns. Only the trusted workspace may invoke
settings IPC; device pages must not receive settings or token access.

The dialog contains:

- An **Enable web server** toggle, applied immediately and persisted across app
  restarts. Missing preferences default to disabled, including upgrades from the
  current always-on API. Show the actual running state and any operation error.
- **Copy token** and **Regenerate token** controls, available even when the server
  is disabled. Copy through Electron's clipboard API. Explain that regeneration
  invalidates existing clients.
- Links to the schema and interactive documentation, available when listening.
- A Close button; settings are applied by their individual controls, with no
  separate Save/Cancel transaction.

## Server lifecycle and persistence

Keep the fixed loopback address `http://127.0.0.1:53241`. Enabling starts the
listener; disabling closes it and its connections, making all routes inaccessible.
Serialize settings mutations to avoid races between toggles and token rotation.
Reuse existing persistence and serialization patterns where applicable. Keep the
enabled preference separate from the bearer token and preserve inventory data.

On startup, start the server only if the saved preference enables it. Malformed
settings, token failures, port conflicts, and persistence failures must be reported
explicitly. A server failure must not prevent desktop session use. Do not show a
successful enabled state when binding fails. Settings must permit retrying failed
startup. Do not report a successful preference change if saving fails; reconcile
the listener with the last saved preference before allowing another change.

Retain the existing 32-byte random hex token format and owner-only token-file
checks. Generate lazily when needed for enabling, copying, or regeneration.
Regeneration securely persists a new token before switching authentication to it;
on failure the existing token remains valid. Requests authenticated after a
successful rotation must reject the old token, without requiring an app restart.
Already authorized operations may finish. Never log tokens or place them in URLs.

## Public documentation and authentication

When the server is enabled:

- `GET /openapi.json` returns the OpenAPI JSON without bearer authentication.
- `GET /docs` provides Swagger UI without bearer authentication, with locally
  bundled assets and no CDN dependency. All required documentation assets are
  also public. The UI loads `/openapi.json` and supports Authorize and Try it out.
- Session routes retain bearer authentication, including calls from Swagger UI.
  Do not automatically inject the desktop token into documentation. Do not persist
  Swagger authorization across page reloads.

Keep Host validation and loopback binding. Permit browser-origin requests only
when Origin exactly matches the validated local request origin (scheme, host,
and port). Continue supporting non-browser clients without Origin and rejecting
foreign or null origins. Do not enable permissive CORS. Serve only explicitly
allowed bundled asset paths, with appropriate content types.

Update OpenAPI authentication metadata to mark the schema route public and
describe the new settings and documentation flow. Update README instructions to
replace automatic startup, menu-only token copying, and manual file deletion for
rotation.

## Implementation approach

Reuse the existing Node HTTP server and Electron IPC rather than adding a web
framework or a second listener. Use bundled Swagger UI distribution assets: this
is a new dependency justified by the requested interactive documentation.
CDN-hosted Swagger UI would require network access; a custom documentation client
would duplicate a maintained interface. Neither alternative is selected.

## Acceptance and verification

- A fresh profile and an existing profile without the preference do not listen.
- Enabling exposes the API; restarting preserves the enabled preference.
- Disabling closes the listener, including documentation and existing keep-alive
  connections; restarting preserves the disabled preference.
- Copy obtains the current token while disabled or enabled. Successful rotation
  survives restart, rejects the old token, and accepts the new one immediately.
  Failed rotation retains the old valid token and reports the error.
- Schema, documentation, and required assets load without authorization and work
  without external network access. Session requests without a token return 401.
- Swagger UI can authorize and execute a session-list request. Same-origin browser
  calls succeed with the token; foreign origins and invalid Hosts remain rejected.
- Port conflicts and write failures are visible without breaking desktop use or
  claiming a state change succeeded.
- Exercise settings through the actual dialog and menu, including keyboard
  dismissal, status/error feedback, and restart persistence. Extend relevant
  existing API unit and packaged-app validation checks; run the applicable checks.
