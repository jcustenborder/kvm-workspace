# Device Password Editor Implementation Plan

> **For agentic workers:** Execute inline using superpowers:executing-plans, task by task.

**Goal:** Save device passwords from Add/Edit and verify they establish sessions.

**Architecture:** Keep native Keychain storage and the existing isolated login preload. Pass a separate optional credential update through inventory IPC; never include credentials in persisted device records.

**Tech Stack:** Electron, CommonJS, native HTML, Playwright, Node test runner.

## Global Constraints

- Keep existing Keychain service and stable device IDs.
- Blank preserves credentials; explicit removal applies on Save; Cancel discards edits.
- Preserve certificate checks, 2FA, isolation, and bounded manual fallback.
- Do not claim real-device authentication without real-device evidence.

### Task 1: Editor-to-session credential flow

**Files:** `src/index.html`, `src/inventory.js`, `src/preload.cjs`, `src/main.cjs`, `scripts/validate-passwords.cjs`.

**Interface:** `workspace.save(device, passwordChange)` accepts an optional string (replacement), null (removal), or undefined (unchanged). Persist only normalized device details.

- [x] Adapt the packaged password validation to save through actual editor controls. Verify blank preserves, replacement changes authentication, removal stops it, Cancel discards, and a write error keeps the dialog open. Reuse existing HTTPS fixture and credential-store boundary.
- [x] Run `npm run package && npm run test:passwords` and observe failure before adding the field.
- [x] Add `input#device-password` with `type="password"` and `input#device-remove-password` checkbox. Compute the update with `passwordInput.value || (removePassword.checked ? null : undefined)`; clear both on close.
- [x] Validate the change type before mutating state. Run `updateDevices(current.devices,value)` before writing Keychain; serialize with `credentials:${value.id}`, reject pending removal, and surface failures. Persist normalized details only.
- [x] Remove the session save/forget functions and save-completion listener. Retain forget notification for canceling pending credential reads when removing through the editor.
- [x] Run the updated packaged password check.

### Task 2: Login diagnosis and regression coverage

**Files:** `src/session-preload.cjs`, `scripts/validate-passwords.cjs`.

- [x] Trace the current form-recognition and Keychain lookup paths. Report missing credentials and unrecognized forms without logging secrets. Capture concrete reproduction evidence before changing recognition or submission behavior.
- [x] Keep regression checks for token ordering, SPA expiry, 2FA, rejection, navigation, delayed reads, and device isolation while replacing old menu-based setup.
- [x] Run `npm test`, `npm run test:inventory`, `npm run test:passwords`, and `npm run test:windows -- --ci` against the packaged application.

### Task 3: Documentation and PR

**Files:** `README.md` and this plan.

- [x] Document editor save/replace/remove and the limits of real-device verification.
- [x] Review `git diff --check`, status, full diff, recent commits, remote tracking, and diff from `origin/main`.
- [ ] Commit only intended files, push the branch, and create a PR with `gh pr create`, including checks and remaining real-device validation.

## Verification outcome

The packaged editor-to-session flow passes with both the replaceable credential
store and real native macOS Keychain. All 23 unit tests, packaged inventory checks,
and synthetic window checks pass. Read-only code review found a retry-ID issue;
its regression failed before retaining one new-device ID per editor dialog, then
passed after the fix. The reviewer rechecked and found no remaining actionable
issues. Missing-password and unrecognized-form status paths are covered. No real
device was selected, so the user's original empty-field root cause remains
unconfirmed; login recognition and submission rules were not broadened by guesswork.
