# Remember Sound Output Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore each KVM's last explicit sound-output on/off choice across reloads, window reopen, and app restart.

**Architecture:** Keep an optional `soundOutputs: Record<string, boolean>` map in the existing atomic inventory file. The isolated session preload reads and saves only its own session's preference through validated IPC, and operates the existing firmware speaker control after WebRTC initialization. Trusted clicks on the status/settings speaker controls record explicit intent; automatic firmware changes do not.

**Tech Stack:** Electron 45, browser DOM APIs, Node's built-in test runner, existing Playwright dependency.

## Global Constraints

- No new dependency, global audio preference, microphone restoration, local speaker-device persistence, or replacement media transport.
- Microphone and camera capture remain manual.
- Accept older inventories with no preference; reject malformed saved values.
- Preserve it when editing a device and remove it when deleting that device.
- Do not interpret teardown, temporary disconnection, or Direct mode's forced audio disablement as an explicit off choice.
- No commits without an explicit user request. Execute inline in the existing isolated worktree.

---

### Task 1: Persist and authorize per-device output preferences

**Files:** `src/model.cjs`, `src/main.cjs`, `tests/model.test.cjs`.

**Interfaces:** Inventory gains optional `soundOutputs: Record<string, boolean>`. `session:sound-output:get` returns `boolean | null`; `session:sound-output:set(enabled: boolean)` returns `Promise<void>`. Both require the owning session's main frame and exact selected HTTPS origin.

- [x] Add a model test round-tripping `{soundOutputs:{a:true,b:false}}`, preserving it across device edits, accepting old inventories unchanged, and rejecting null/array maps, missing-device keys, and non-boolean values.
- [x] Run `node --test tests/model.test.cjs`; confirm new assertions fail before implementation.
- [x] Validate the optional map using the already-validated device IDs and `typeof enabled === 'boolean'`. Include it only when present to preserve the existing old-inventory shape.
- [x] Add a session sender validator parallel to `requireInventory`. Read only own map entries (`Object.hasOwn`) or return null. Write inside `updateData` with `{...current,soundOutputs:{...current.soundOutputs,[item.deviceId]:enabled}}`; reject non-booleans, removed devices, and stale documents. Route write failures to existing `report` and reject the invocation.
- [x] Remove the matching map entry atomically with device deletion; ordinary inventory edits retain the top-level map through the existing spread.
- [x] Run `node --test tests/model.test.cjs` and confirm all tests pass.

### Task 2: Restore firmware output and capture explicit intent

**Files:** `src/session-preload.cjs`, `scripts/validate-windows.cjs`, `README.md`.

**Interfaces:** Preload consumes Task 1's private IPC. It reads `.volume-icon use` with `href` or `xlink:href` equal to `#gl-kvm-sound-full` or `#gl-kvm-sound-off`. Firmware's GlSvg source confirms those SVG references. Ready state is `#stream-window.stream-window-inited` outside `.is-direct` mode.

- [x] Extend the synthetic HTTPS page with firmware-shaped status/settings speaker controls, a ready WebRTC stream container, and counters for output toggle and capture attempts. Delay readiness so startup defaults can be observed; defer icon rendering to a microtask like Vue.
- [x] Add lifecycle assertions: trusted status/settings clicks save on/off; reload and window reopen restore exactly once after readiness; another device stays off; Direct mode and teardown do not save forced off; returning from Direct restores desired output; unknown/disabled controls are not clicked; no capture occurs. Verify inventory edits preserve saved output and deletion removes it.
- [x] Add source-launch support to the existing validation script using `--source` so it can exercise current code without packaging. Run `node scripts/validate-windows.cjs --ci --source` to observe failure before preload implementation.
- [x] In isolated preload, load the saved preference, then use bounded-attempt 250 ms polling (following the existing liveness timer pattern) to restore through the existing status control's click event after readiness. Record trusted clicks on either `.volume-icon` or a settings speaker `.icon-button` only after the output state actually changes. Never expose IPC on `window` or call `getUserMedia`.
- [x] Keep desired state separate from observed firmware state. Restore once per page and once after leaving Direct mode; explicit user interaction takes precedence over pending restoration/read results. Clear timers/listeners at `pagehide`. Show a `role=alert` notice and log an explicit error if saved-state restoration cannot recognize/operate the control within 30 seconds of WebRTC readiness. Never repeatedly toggle on failure.
- [x] Extend the synthetic test to close/relaunch the app with the same test profile and prove on/off survives app restart; use real isolated-preload execution and exercise rejected IPC from inventory/subframes or with invalid values through the Electron test harness.
- [x] Document the per-KVM remembered output behavior under README's audio section.
- [x] Run `npm test` and `node scripts/validate-windows.cjs --ci --source`; inspect `git diff --check` and the final diff. Report synthetic coverage separately from any available real-KVM validation.

## Verification outcome

- Node suite: 13 tests passed.
- Synthetic Electron validation passed, including on/off after full app restart,
  delayed Vue-style icon rendering, unavailable controls, and private IPC checks.
- The extended test exposed a native-focus assumption in the keyboard test:
  macOS does not activate a background app through `BrowserWindow.focus()` alone.
  The harness now explicitly activates the app and waits for actual focus before
  asserting input cleanup; the original key-release assertion still runs.
- Independent read-only code review found no blocking defects.
- Real-KVM sound reconnection was not exercised. Native Window menu and Keychain
  validation remain skipped by the existing `--ci` mode.
