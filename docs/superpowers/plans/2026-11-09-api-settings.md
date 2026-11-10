# API Settings Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Add default-off API settings, token rotation, and bundled public Swagger documentation.

**Architecture:** Keep the existing Node HTTP server. A small API settings controller owns the listener, saved preference, and token; trusted inventory IPC exposes actions to a native HTML dialog.

**Tech Stack:** Electron, Node.js, native HTML dialogs, swagger-ui-dist, node:test, Playwright.

## Global Constraints

- Bind only `127.0.0.1:53241`; missing preference means disabled.
- `/openapi.json` and `/docs` require no authentication when enabled.
- Session endpoints require a bearer token; only exact same-origin browser calls are allowed.
- Bundle documentation assets; do not persist Swagger authorization or expose the token to docs.
- Keep token files owner-only; report persistence and listener errors explicitly.

### Task 1: Public documentation and rotatable authentication

**Files:** `src/api.cjs`, `src/openapi.cjs`, new `src/api-docs.html` and `src/api-docs.js`, `tests/api.test.cjs`, `package.json`, `package-lock.json`.

**Interfaces:** Preserve `createApi({token,list,command})`, allowing token to be a `() => string` getter as well as a string. Export `rotateApiToken(directory: string): Promise<string>`.

- [ ] Extend HTTP tests to expect unauthenticated JSON/docs/assets, same-origin authenticated access, rejection of foreign/null origins, and live token changes.
- [ ] Run `node --test tests/api.test.cjs` and confirm the new expectations fail.
- [ ] Install pinned `swagger-ui-dist`; explicitly map the CSS, bundle, preset, and initializer routes. Serve docs with a restrictive CSP and local schema URL.
- [ ] Move authentication after public-route handling. Validate Host first and Origin against `http://${request.headers.host}`. Preserve all session validation.
- [ ] Persist a generated token with an exclusive owner-only temporary file and atomic rename; retain the old token on failures.
- [ ] Run `node --test tests/api.test.cjs`.

### Task 2: Settings lifecycle and persistence

**Files:** new `src/api-settings.cjs`, new `tests/api-settings.test.cjs`, `src/main.cjs`.

**Interfaces:** `createApiSettings({directory,list,command,port?,onError?})` returns `initialize()`, `status()`, `setEnabled(enabled: boolean)`, `copyToken(): Promise<string>`, `regenerateToken(): Promise<void>`, and `close(): Promise<void>`. Status contains `enabled`, `running`, and `error` without token data. Test-only ephemeral ports use port 0.

- [ ] Test missing preference is off, enable/disable and restart persistence, rotation authentication, bind failure and retry, malformed settings, and failed writes preserving prior state.
- [ ] Run `node --test tests/api-settings.test.cjs` to confirm failure before implementation.
- [ ] Serialize mutations using the existing serial helper. Store `{enabled:boolean}` in `api-settings.json` through an atomic write. Start before saving enablement; roll back listener changes if persistence fails. Keep enabled intent distinct from actual listener state.
- [ ] Replace unconditional startup in main with controller initialization. Add inventory-guarded IPC for status, toggle, clipboard copy, regeneration, and opening fixed docs URLs. Quit closes connections immediately.
- [ ] Run API and settings unit tests.

### Task 3: Settings dialog and end-to-end verification

**Files:** `src/index.html`, new `src/settings.js`, `src/preload.cjs`, `src/main.cjs`, `scripts/validate-api.cjs`, `README.md`.

**Interfaces:** Preload exposes `apiStatus()`, `setApiEnabled(enabled)`, `copyApiToken()`, `regenerateApiToken()`, `openApiDocs(page)` with `page` restricted to `docs` or `openapi.json`, and `onSettings(callback)`.

- [ ] Add a workspace Settings button and labeled dialog using existing styles. Include enable checkbox, runtime status, copy/regenerate buttons, docs/schema buttons, inline errors, live status feedback, and Close. Disable mutation controls while busy; support Escape and focus restoration.
- [ ] Add Settings… menu entry with `CommandOrControl+,`. Show the inventory and deliver the dialog-open event after its renderer loads when necessary.
- [ ] Extend existing Electron validation: verify default off through real UI, enable, copy and rotate, load offline Swagger in a separate browser page and execute an authorized list request, then disable and test restart persistence. Preserve existing session-control checks.
- [ ] Update README API setup, public documentation paths, browser-origin policy, and token rotation instructions.
- [ ] Run `npm test`, `npm run package`, and `npm run test:api`. Inspect `git diff --check` and all intended diffs.
- [ ] Commit intended changes, push the current branch, and open a GitHub PR describing behavior and verification evidence.

## Plan review

All approved spec sections map to the three tasks above. Controller status never includes a token; copy happens in main. No additional listener, web framework, custom documentation UI, or inventory schema migration is needed.
