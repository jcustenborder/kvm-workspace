# Mouse Jiggle and OCR Local API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose authenticated Mouse Jiggle state/toggle and native OCR triggering through the existing local session API.

**Architecture:** Extend the existing serialized `sessionAction()` browser path. Observe the RM1PE firmware's rendered controls, click each control at most once, and confirm the resulting DOM state before returning.

**Tech Stack:** Electron 45, Node.js HTTP server and test runner, Playwright synthetic validation, OpenAPI 3.1.

## Global Constraints

- Preserve bearer authentication, loopback Host/Origin restrictions, device-name validation, and stable-device serialization.
- Require an open ready session; never start, focus, retry, or simulate mouse movement.
- Preserve all existing endpoints and response fields.
- Verified firmware target is RM1PE `V1.10.1 release2` with the English device UI.

---

### Task 1: API contract

**Files:**
- Modify: `tests/api.test.cjs`
- Modify: `src/api.cjs`
- Modify: `src/openapi.cjs`

**Interfaces:**
- Produces: `POST /sessions/{name}/mouse-jiggle/toggle` returning `{enabled:boolean}`.
- Produces: `POST /sessions/{name}/ocr` returning `{triggered:true}`.
- Produces: session property `mouseJiggle:{enabled:boolean|null}`.

- [ ] Add failing HTTP tests that require authentication for both routes, reject unexpected bodies, dispatch the exact action names, preserve existing session fields, and expose both OpenAPI operations and response schemas.
- [ ] Run `node --test tests/api.test.cjs`; verify failures are missing-route/schema failures.
- [ ] Add both empty request schemas to `bodies`, route both POST actions through the existing regex and validation, extend the session schema, and add `{enabled:boolean}` and `{triggered:boolean}` success schemas.
- [ ] Run `node --test tests/api.test.cjs`; verify it passes.

### Task 2: Firmware controls and observed state

**Files:**
- Modify: `scripts/validate-api.cjs`
- Modify: `src/session-actions.cjs`
- Modify: `src/main.cjs`

**Interfaces:**
- `sessionAction('read', {})` returns `{enabled:boolean|null,mouseJiggleEnabled:boolean|null}`.
- `sessionAction('mouse-jiggle/toggle', {})` returns `{enabled:boolean}` after confirmation.
- `sessionAction('ocr', {})` returns `{triggered:true}` after `#gl-kvm-ocr-canvas` becomes visible.

- [ ] Extend the synthetic firmware page with `.remote-device-setting` containing Show Local Cursor and Mouse Jiggle `button[role="switch"]` controls, plus `.ocr-box button` and `#gl-kvm-ocr-canvas`.
- [ ] Add failing synthetic assertions for list and named-session state, both toggle directions, manual state observation, closed/unready/unknown states, failed confirmation with one click, OCR success, OCR absence, OCR failed confirmation with one click, and concurrent serialization.
- [ ] Run `npm run test:api`; verify failures identify the missing actions and session field.
- [ ] Read Mouse Jiggle only when the stream is initialized and the second `.remote-device-setting button[role="switch"]` belongs to an item whose `.label` text is `Mouse Jiggle`; parse only `aria-checked="true"` or `"false"`.
- [ ] Toggle by dispatching one bubbling click and polling the observed state for 1500 ms. Trigger OCR through `.ocr-box button` once and poll until `#gl-kvm-ocr-canvas` has client rects. Throw explicit readiness or confirmation errors otherwise.
- [ ] Extend `sessionInfo()` with `mouseJiggle`, and return Mouse Jiggle/OCR mutation results without speaker persistence.
- [ ] Run `npm run test:api`; verify it passes.

### Task 3: Documentation and release verification

**Files:**
- Modify: `README.md`
- Verify: `src/openapi.cjs`

**Interfaces:**
- Documents endpoint methods, response bodies, null semantics, supported mode, firmware and English-UI requirement, and failure behavior.

- [ ] Update the endpoint table, examples, and session response documentation for Mouse Jiggle and OCR.
- [ ] Run `npm test` and `npm run test:api`.
- [ ] Inspect `git diff --check`, the complete diff, and repository status; commit only intended files.
- [ ] Push the branch and create a GitHub PR summarizing the verified contract and checks.
