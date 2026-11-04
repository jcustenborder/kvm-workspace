# Saved Password Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Automatically authenticate each saved KVM using its native Keychain password.

**Architecture:** A main-process credential module owns native Keychain access
and validates the session/frame/origin. The existing sandboxed preload fills only
the firmware login form and hides it during a single bounded login attempt.

**Tech Stack:** Electron 45, CommonJS, Node test runner, Playwright,
`@napi-rs/keyring` 2.1.2.

## Execution evidence

Implemented and independently reviewed. `npm test` (23 tests on the current base), packaging/signature
verification, synthetic password checks, a real Keychain round trip, inventory
validation, and window validation with `--ci` all passed. Review regressions cover
delayed saves preserving newer input, token-first restoration, and forgetting
while a credential read is pending. The checklists below record the original
implementation sequence; the PR publishes the completed result.

## Global Constraints

- One password per stable device ID, shared across configured LAN/Tailscale routes.
- No passwords in inventory JSON, encrypted token files, logs, shell arguments, or localStorage.
- Keep sandbox/context isolation, exact HTTPS origin checks, and TLS verification.
- Automatic login attempts once per appearance, with a 15-second manual fallback.
- Two-factor authentication requires manual OTP entry and submission.

### Task 1: Keychain storage and session authorization

Files: `src/passwords.cjs`, `tests/passwords.test.cjs`, `package.json`,
`package-lock.json`, `scripts/package.mjs`.

- [ ] Write failing Node tests for credential identity, exact frame/origin checks,
  address removal, and read errors. Use a fake native store only at the OS boundary.
- [ ] Run `node --test tests/passwords.test.cjs` and confirm missing behavior.
- [ ] Add the pinned binding and implement `passwordEntry(deviceId)` with
  `new AsyncEntry('com.scarcemedia.kvm-workspace.password', deviceId)`; implement
  `requirePasswordSession(event, sessions, devices)` returning the owning item
  only for its current main frame at its still-configured selected endpoint.
- [ ] Explicitly unpack native `.node` binaries in packaging and verify the build.
- [ ] Run `npm test`.

### Task 2: Automatic authentication and explicit save/forget

Files: `src/main.cjs`, `src/session-preload.cjs`, `scripts/validate-passwords.cjs`.

- [ ] Write a runnable synthetic HTTPS packaged-app check. A login form shaped
  like the firmware tracks submissions and accepts a known synthetic password.
  Test two devices and both routes, rejection, 2FA, SPA expiry, save/forget,
  navigation and isolation. Native-store replacement stays in the test runner.
- [ ] Run it against the current packaged application and observe no auto-login.
- [ ] Register `session:password` IPC with main-frame validation before and after
  `await item.loginReady` and Keychain reads. Keep token restoration in a
  `try/finally` that resolves `item.loginReady` even on absent files.
- [ ] Implement preload observation of the exact login route/form, isolated IPC
  retrieval, native input-value setter plus bubbling input/change events, and
  one `button.click()` per appearance. A status conceals the form only while
  pending. Errors, 2FA, user edits, and the deadline restore manual access.
- [ ] Add Save Password and Sign In / Forget Saved Password menu commands. Read
  only the recognized current login field, serialize Keychain changes under
  `credentials:${device.id}`, and validate the current device/origin again.
- [ ] Delete the password during inventory removal before publishing removal;
  a Keychain error must leave the device available for retry.
- [ ] Run the synthetic check and existing packaged window/inventory checks.

### Task 3: Documentation, review, and PR

Files: `README.md`, `package.json` and `.github/workflows/release-macos.yml`.

- [ ] Document explicit first save, automatic authentication, failure/2FA
  fallback, update/forget, stable identity, and difference from saved tokens.
- [ ] Add `test:passwords` and run it in macOS CI after packaging.
- [ ] Run `npm test`, `npm run package`, `npm run test:passwords`,
  `npm run test:inventory`, and `npm run test:windows -- --ci`.
- [ ] Review all changes for password leakage, async navigation races,
  unconditional retries, unintended field filling, and native-module packaging.
- [ ] Inspect git status/diff/log, commit intended files, push, and open the PR
  against `main` with verification evidence and real-device limitations.
