# GitHub release updates

## Goal

Update the installed Apple Silicon macOS application from stable releases in
`jcustenborder/kvm-workspace`, asking before downloading and again before
installing. Retain the existing Electron Packager and signed DMG installation flow.

## Application behavior

- Use a pinned `electron-updater` runtime dependency and its GitHub provider.
- Check after startup and every six hours. Add **Check for Updates…** to the
  application menu. Only one check or download may run at a time.
- Enable updating only in distribution builds prepared by the release workflow.
  Source runs and ad-hoc validation packages must not contact the update service.
- Select newer stable versions only; exclude drafts, prereleases, and downgrades.
- An available update shows its version and **Download** / **Later**. Checking
  must never download an update automatically.
- After a successful download, offer **Install and Restart** / **Later**. Explain
  that restarting closes all active KVM sessions. Installation requires explicit
  approval; choosing Later must also prevent installation on normal quit.
- A downloaded update remains accessible from the application menu so the user
  can install it later. Restarting the app must not silently install it.
- Background checks finding no update remain quiet; a manual check reports that
  the application is up to date. Avoid repeatedly prompting for the same version
  during one application run after the user chooses Later; a manual check may
  offer it again.
- Report check, download, and installation errors clearly, with diagnostic logs.
  A failed background check must not interrupt active sessions with a modal;
  retain an accessible error indication in the update menu. Manual actions show
  actionable errors. Failed updates leave the existing installation usable.
- Preserve the application identity, user-data directory, saved inventory,
  certificate trust, and encrypted login files.

## Integration

Keep update orchestration in a small main-process module using Electron dialogs
and the existing application menu. Device pages receive no updater APIs or IPC.
Configure explicit consent using the supported API of the pinned updater version;
verify macOS behavior rather than assuming a generic install-on-quit setting
prevents native Squirrel staging. If download completion stages an update that
will install on quit despite opting out, that version/configuration fails this
design's acceptance criteria and must be corrected before shipping.

Use the GitHub provider directly with bundled release-only provider configuration;
no hosted update service or credentials are required. Preserve macOS native code
signature validation and the updater's archive integrity verification. Download
complete archives rather than introducing differential-update artifacts.

## Release changes

After signing, notarizing, and stapling the app, produce a versioned arm64 ZIP of
that exact application using macOS archive tooling. Generate `latest-mac.yml`
with the embedded release version, ZIP asset name, SHA-512 digest, and size, in
the format expected by the pinned updater. Include any required release-only
updater configuration in the app before code signing.

Upload the ZIP and metadata alongside the existing DMG and checksum to the draft
GitHub release, including on resumed drafts. Publish only after all required
assets have been generated and verified. Existing release-version allocation,
signing, notarization, and credential cleanup remain in place.

The first installation of an updater-enabled release requires the existing DMG
installation process. Subsequent updater-enabled releases can update in place.

## Verification and success criteria

- Runnable Node tests exercise the orchestration with injected updater/dialog
  fakes: checks never download, Download approval is required, installation
  approval is required, Later never quits, concurrent actions are bounded, and
  failures permit retry without closing sessions.
- Verify stable-version selection and disabling updates in development/ad-hoc
  packages using the updater's provider/configuration behavior where applicable.
- Verify generated metadata against the actual ZIP bytes and release version.
  Archive the signed, stapled app without changing its bundle identity.
- Run the existing unit tests and packaged inventory/window checks appropriate
  to the changed application and packaging code.
- Before claiming end-to-end updating works, test two signed release versions
  on macOS: decline download, approve download, defer installation and quit
  normally without updating, relaunch, then explicitly approve installation.
  Confirm the newer version launches and saved devices/logins remain available.
  Unit tests do not substitute for this signed native-updater verification.

## Scope

Apple Silicon macOS and the existing public GitHub stable-release channel only.
No additional platforms, prerelease channel, settings screen, custom installer,
release hosting, or packaging-framework migration.
