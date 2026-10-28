# KVM Workspace Implementation Plan

> **For agentic workers:** execute scoped tasks with reviewed evidence and
> verification; do not commit unless explicitly requested.

**Goal:** A separate multiwindow GLKVM-compatible macOS application with real
full-duplex audio and a persistent LAN/tailnet device list.

**Architecture:** Preserve the actual device browser client in isolated,
sandboxed top-level windows; use a compact local inventory. Validate the
Chromium media path before committing to a native signaling reimplementation.

**Tech Stack:** arm64 Electron/Chromium, JavaScript with parameter type annotations,
Node built-in tests, macOS capture permissions and Keychain-backed encryption.

## Global constraints

- M4 Max, macOS 26.6.2; no M5 performance claims.
- No arbitrary session limit, layout manager, VPN client, or cloud replacement.
- No video-only substitute for conference-call acceptance.
- No reference application modification or copying proprietary implementation.
- Never retain passwords, tokens, or raw credential headers in investigation docs.
- Tests must assert behavior; simulated media tests are not live KVM evidence.

## Tasks

1. **Reference and device investigation** — `investigation/`, `docs/feature-parity.md`.
   - [x] Retain REA artifact identities, inspect desktop session ownership.
   - [x] Inspect deployed firmware control/media entry points and compare source.
   - [x] Record model/firmware/auth/media/input/audio and unknowns with locations.
2. **Local inventory and safe host** — `src/main.cjs`, `src/model.cjs`,
   `src/preload.cjs`, `src/index.html`, `src/inventory.js`, `tests/model.test.cjs`.
   - [x] First test invalid endpoints, secret-free records, and permission/origin boundaries.
   - [x] Implement save/edit/remove, per-device LAN/tailnet choice, isolated windows.
   - [x] Implement explicit certificate trust with persisted endpoint fingerprints.
   - [x] Test failures and close/reconnect independence without live hardware mutation.
3. **Packaged media validation** — `scripts/package.mjs`, `scripts/benchmark.mjs`.
   - [x] Build a standalone arm64 app with microphone/camera usage descriptions.
   - [x] Verify real login/video and explicit microphone enablement in packaged app.
   - [x] Record WebRTC decoder/stats and full helper-process resources.
   - [x] Investigate and verify the packaged two-way audio transport before expansion.
4. **Parity and multiwindow acceptance** — `docs/feature-parity.md`, `docs/validation.md`.
   - [ ] Test device controls, downloads/uploads, input capture and pointer scaling.
   - [ ] Run three real devices and sustained call, or name exact unavailable validation.
   - [ ] Measure long-run close/reopen recovery and compare reference at matched stream settings.
5. **Delivery** — `README.md`, `docs/performance.md`.
   - [x] Document build/run, explicit device trust, credential handling, measured
         conditions/results, compatibility gaps, and outstanding acceptance gates.

No universal performance targets are invented before baseline measurement.

Live acceptance remains blocked on additional real devices, a configured/reachable
tailnet path, and an actual authorized conference-call scenario. The matrix and
validation report distinguish these from implemented/verified host behavior.
