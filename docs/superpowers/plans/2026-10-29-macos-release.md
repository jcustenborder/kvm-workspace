# macOS DMG release implementation plan

**Goal:** Make a signed, notarized Apple Silicon DMG the preferred installation,
with packaged-app PR verification and stable releases only from `main`.

**Architecture:** Keep Electron Packager and its integrated macOS signing and
notarization. Use GitHub-hosted macOS runners and native disk-image tools. PRs
build ad-hoc artifacts without secrets; version tags publish notarized DMGs.

**Constraints:** Preserve `com.scarcemedia.kvm-workspace`, saved data locations,
existing local packaging and full interactive validation. No auto-update,
Intel support, branch prereleases, new runtime dependencies, or automatic commits.

## Tasks and acceptance

- [x] Add an explicit `--release` packaging mode in `scripts/package.mjs`.
  Require signing identity, keychain, and Apple credentials before packaging;
  use Packager's nested signing and notarization, verify signature/ticket/Gatekeeper,
  and never overwrite distribution signatures with the local ad-hoc signature.
  Check: `node --test tests/package.test.cjs` proves missing credentials fail closed.
- [x] Add `.github/workflows/release-macos.yml` for stable `v*` tags.
  Require tag/package version equality and ancestry on `origin/main`; run tests,
  import/validate one matching Developer ID in a temporary keychain, build/sign/
  notarize the app, validate its inventory UI, create a DMG with `/Applications`
  symlink, sign/notarize/staple/verify/mount it, then publish DMG and checksum.
  Reject existing releases and clean up signing material with `if: always()`.
- [x] Add `.github/workflows/verify.yml` for PRs and `main` pushes.
  Run unit tests, local packaging, inventory and synthetic session validation;
  upload the app ZIP and synthetic report. Add explicit `--ci` boundaries around
  Accessibility and interactive Keychain checks, reporting those omissions.
- [x] Update README installation, CI boundaries, secrets and maintainer release steps.
- [x] Verify with `npm test`, `npm run package`, `npm run test:inventory`,
  `npm run test:windows -- --ci`, `actionlint`, and `git diff --check`.
  Real notarization runs require GitHub's stored secrets and a pushed version tag;
  final downloaded-DMG installation remains a first-release manual acceptance check.

## Verification evidence

- Eight unit/regression tests pass, including rejection of credentialless release builds.
- Local ad-hoc packaging and all nine inventory UI checks pass.
- All eleven CI-mode synthetic session checks pass; both interactive omissions are reported.
- Both workflows pass `actionlint`; the diff passes `git diff --check`.
- A locally created compressed DMG passed native checksum verification, mounted
  with the Applications shortcut, passed bundle signature verification, and ran
  all nine inventory UI checks directly from the mounted image.
- Developer ID signing, Apple notarization and GitHub publication have not been
  executed locally; they require the first tag-triggered workflow run.
