# GitHub Auto-Updates Implementation Plan

> **For agentic workers:** Use executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Deliver consent-based GitHub release updates for signed arm64 macOS builds.

**Architecture:** A main-process controller owns checks, dialogs, and update-menu state. Electron Packager bundles release-only provider configuration before signing; the release workflow publishes the stapled app ZIP and metadata alongside its DMG.

**Tech Stack:** Electron 45.1.0, electron-updater 6.8.11, CommonJS, Node test runner, macOS signing tools.

## Global Constraints

- Stable public releases from `jcustenborder/kvm-workspace`, Apple Silicon macOS only.
- Explicit consent before download and before installation; normal quit never installs.
- No updater network requests in development or ad-hoc validation builds.
- Preserve bundle identity, application data, existing packager, and DMG distribution.
- Work inline in the existing isolated worktree; do not commit or push without a new request.

## Task 1: Consent controller and application integration

**Files:** Create `src/updates.cjs` and `tests/updates.test.cjs`; modify `src/main.cjs`, `package.json`, and `package-lock.json`.

**Interfaces:** `createUpdates({updater,dialog,menuItem,logger})` returns `{check(manual:boolean):Promise<void>}`. `updatesEnabled(app,platform,arch,resourcesPath)` checks packaged darwin arm64 and release-only provider config presence.

- [x] Write tests with EventEmitter updater and dialog fakes covering Download/Later, Install/Later, manual retry, background errors, no-update feedback, overlapping actions, and suppressed repeated prompts.
- [x] Run `node --test tests/updates.test.cjs`; confirm missing module failure.
- [x] Pin `electron-updater` at 6.8.11 with `npm install --save-exact electron-updater@6.8.11`.
- [x] Implement the controller with `autoDownload=false`, `autoInstallOnAppQuit=false`, `allowPrerelease=false`, `allowDowngrade=false`, and `disableDifferentialDownload=true`. Keep native staging behind `quitAndInstall()` only. Log updater errors and ensure rejected promises are handled.
- [x] Integrate the update menu after About; start a nonblocking check after inventory opens and a six-hour unref'd interval only for release builds. Use menu state for checking/downloading, deferred install, and background errors.
- [x] Run `node --test tests/updates.test.cjs` and `npm test`.

## Task 2: Release configuration and update artifacts

**Files:** Modify `scripts/package.mjs` and `.github/workflows/release-macos.yml`; create `scripts/update-metadata.cjs` and `tests/update-metadata.test.cjs`.

**Interfaces:** `createMetadata(version:string,archivePath:string)` asynchronously returns `{version,files:[{url,sha512,size}],path,sha512,releaseDate}`. The command `node scripts/update-metadata.cjs VERSION ARCHIVE` writes JSON (valid YAML) to stdout for `build/latest-mac.yml`.

- [x] Write a real-byte archive fixture test asserting SHA-512 digest, size, asset basename, version validation, and errors for empty/missing archives.
- [x] Run `node --test tests/update-metadata.test.cjs`; confirm missing module failure.
- [x] Generate release-only `app-update.yml` through Packager's `afterCopy` hook at `path.join(buildPath,'..','app-update.yml')`, outside ASAR and before signing. Use JSON with provider `github`, owner `jcustenborder`, repo `kvm-workspace`, and updater cache name `kvm-workspace-updater`.
- [x] Implement metadata generation with Node fs/crypto/path and strict stable-version and archive-name validation.
- [x] In the release workflow, ZIP the stapled app using `ditto -c -k --sequesterRsrc --keepParent`, generate metadata, extract the ZIP to a temporary directory, and verify extracted app signature, staple, and Gatekeeper assessment. Upload ZIP and metadata on both fresh-release and draft-resume paths before publishing.
- [x] Run metadata tests and all unit tests. Inspect the workflow and package script for signing order and unchanged credential cleanup.

## Task 3: Documentation and verification

**Files:** Modify `README.md` and this plan's checkboxes.

- [x] Document automatic checks, both consent prompts, manual update command, release-only behavior, extra assets, and first-time DMG upgrade requirement.
- [x] Run `npm test`, `npm run package`, `npm run test:inventory`, and `npm run test:windows -- --ci`.
- [x] Inspect the resulting ad-hoc bundle: updater config must be absent and runtime dependencies must be included. Verify native MacUpdater code with a mocked Electron native updater: deferred download must not call native `checkForUpdates`, while explicit install does. This verifies the dependency integration, not signature acceptance.
- [x] Run `git diff --check`, review the complete diff, and report which checks ran.
- [x] Report signed two-version macOS acceptance as pending unless actual signed release artifacts and a real install/update run are available. Do not claim end-to-end verification from fakes.

## Verification results

All 21 unit tests passed. Ad-hoc packaging and signature verification, packaged
inventory validation, and synthetic three-window validation (`--ci`) passed.
The latter excludes Accessibility menu and interactive Keychain checks. The
packaged updater loads with its runtime dependencies, and ad-hoc update config is
absent. Executing the release hook with a substituted packager confirmed provider
configuration placement; workflow YAML parsing and Bash syntax validation passed.
A read-only code review found no material issues. Signed two-version macOS update
acceptance remains pending release artifacts.

## Review

The three tasks cover consent, scheduling, gating, errors/retry, stable-version policy, release production, and preservation of existing installation/data paths. Native signed two-version verification is an external release acceptance gate; local tests can verify orchestration and native staging behavior but cannot replace it.
