# KVM Workspace

A standalone Apple Silicon macOS application modeled on GLKVM, with a saved
device inventory and independent resizable session windows. The implementation
uses Electron/Chromium, as the installed GLKVM app does, while enabling hardware
acceleration and isolating each device's browser/media/input state.

**Status: working validation build, not a completed feature-parity release.**
One real RM1PE has passed LAN authentication, 1080p H.264/VideoToolbox playback,
modifier release, settled-window absolute pointer coordinates, and simultaneous
Opus microphone/speaker transport across a two-minute focus/resize test.
Three-window isolation has passed a synthetic-page test.
Three distinct real devices and a sustained conference call remain unvalidated.

## Install (recommended)

Download the **macOS Apple Silicon DMG** from the
[latest GitHub release](https://github.com/jcustenborder/kvm-workspace/releases/latest).
Open the DMG, drag **KVM Workspace.app** onto **Applications**, eject the disk
image, then open KVM Workspace from Applications. No Node.js installation is
needed. Release DMGs and applications are Developer ID signed and notarized by
Apple. Until the first release is published, use the source-build instructions below.

To update, quit KVM Workspace and replace the application using the newer DMG.
Your saved devices remain in Application Support. Automatic updates are not yet
implemented. Releases currently target Apple Silicon; Intel Macs are not supported.

## Run

Open the installed application:

```sh
open "/Applications/KVM Workspace.app"
```

New installations start with an empty inventory. Real-device saved-login
restoration was verified with Keychain-encrypted tokens. The standalone `.app`
needs no external Node.js or REA installation to run.

The build output is also runnable:

```sh
open "build/KVM Workspace-darwin-arm64/KVM Workspace.app"
```

1. Choose **Add KVM**. Save a friendly name and a LAN address, tailnet address,
   or both. HTTPS IP addresses, IPv6 addresses and MagicDNS names are supported.
2. Choose **Open LAN** or **Open Tailnet**. Each device opens in its own window.
   Changing routes requires closing that device's existing window; other
   sessions remain connected.
3. Approve an unfamiliar device certificate only after checking its displayed
   SHA-256 fingerprint. Trust is saved for the selected endpoint. Certificate
   changes require fresh approval; there is no global TLS bypass.
4. Sign in using the KVM's administrator password. A GL.iNet account is not
   required for direct device access.

The actual device's **Session, Toolbox, Accessories, Virtual Media, Apps Center,
Help, and settings** interfaces remain available. They are served by the KVM's
firmware, just as in the reference app. No proprietary desktop code is included
in this application's bundle.

### Audio and input

- Use **Session → Audio** inside the device UI for speaker, USB microphone,
  mute and press-to-speak controls. **Direct** video mode has no audio; use an
  appropriate WebRTC mode for calls.
- macOS and the application require explicit microphone/camera permission.
  On microphone capture, choose the local input for that KVM. A provisional
  stream used to obtain device labels is stopped before the selected stream is
  returned to the firmware; it is not attached to a peer connection.
- Focusing another window releases held input; it does not select a microphone
  destination or change a manually enabled microphone's mute state.
- **Session → Choose Local Speaker…** selects an available output for that
  window. **Choose Microphone on Next Capture** requests a fresh input picker
  the next time capture starts. Live microphone hot-swap without restarting
  capture is a remaining gap. Turn microphone and speaker off, then enable
  them again to restart capture without reconnecting video.
- **Session → Release Keyboard and Mouse** releases held controls and pointer
  lock. Special keys and text paste are available through the firmware toolbox.
  Normal macOS-reserved shortcuts remain OS-controlled.
- A no-recent-frames indicator marks potentially stale WebRTC output. It is an
  uncertainty indicator, not a measurement of end-to-end video latency. Direct
  canvas-mode liveness is explicitly unmonitored.

### Saved logins

Use **Session → Save This Login Securely** to retain the current authentication
tokens with macOS Keychain-backed encryption. The password is not saved. Session
expiry or revocation can still require signing in again. **Forget Saved Login**
removes the retained login while leaving the current connection open.

Named devices and certificate fingerprints live in the application's own
`Application Support/KVM Workspace/devices.json`. Encrypted logins are separate
`login-<device-id>.encrypted` files. Device pages use in-memory, per-device
browser partitions; window closure clears their browser storage and connections.

## Build from source

Requires macOS, Node.js >=22.12, npm, and network access for the pinned Electron
runtime. Tested on M4 Max, macOS 26.6.2, arm64, with Node 26.12.1.

```sh
npm ci
npm test
npm start
npm run package
```

Packaging creates an arm64 `.app`, applies a local ad-hoc code signature, and
verifies the full bundle. This is a local build, not a notarized distribution;
published DMGs use the signed release process described below.

```sh
npm run test:inventory
npm run test:windows
```

For a focused native Window-menu check:

```sh
node scripts/validate-windows.cjs --menu-only
```

It verifies session entries, selection/restoration of minimized windows, and
close/reopen updates using macOS System Events. The test runner needs macOS
Accessibility permission; the application itself uses the standard native menu.

The inventory check uses actual Add/Edit/Save/Cancel/Remove buttons in the
packaged application with a disposable profile and verifies restart persistence.
The window check exercises the **packaged application** with synthetic HTTPS pages,
including actual TLS, native windows, filesystem failures and Keychain-backed
token encryption. It does not represent three real KVMs.

### Continuous integration

Pull requests and pushes to `main` run unit tests and build the Apple Silicon
application on macOS. They exercise the packaged inventory UI and synthetic
HTTPS sessions with `npm run test:windows -- --ci`, including certificate pin
isolation, separate session storage, input release, reload/close/reopen, and
filesystem failure handling. The `--ci` mode explicitly skips native-menu
Accessibility automation and interactive Keychain encryption/restoration;
run `npm run test:windows` locally for those checks. No real-device, camera,
microphone, or sustained-call validation is claimed by CI.

Successful verification runs upload an ad-hoc-signed application ZIP for manual
inspection, retained for seven days. These are development artifacts, not the
notarized DMG distribution. PR jobs never receive signing or Apple credentials.

### Publish a signed DMG

The `Release macOS DMG` workflow runs automatically on pushes to `main`, including
merged pull requests. Each successful run publishes a stable GitHub Release with
the signed, notarized DMG and its checksum attached. No manual tag is required;
other branches do not publish releases.

The first release starts at the stable version in `package.json`. Subsequent
releases increment the highest reserved stable release's patch number, for example
`v0.1.0`, `v0.1.1`, `v0.1.2`. Raising `package.json` to a newer version sets a new
minimum. The chosen version is embedded in the packaged app without committing
version changes back to the repository. Release jobs are serialized to avoid
allocating the same version concurrently.

Configure these repository Actions secrets:

| Secret | Value |
| --- | --- |
| `MACOS_CERTIFICATE_P12_BASE64` | Base64-encoded Developer ID Application certificate **with its private key** |
| `MACOS_CERTIFICATE_PASSWORD` | Password chosen when exporting the `.p12`; may be empty for a passwordless export |
| `APPLE_ID` | Apple Developer account email |
| `APPLE_TEAM_ID` | Team ID owning the certificate |
| `APPLE_APP_SPECIFIC_PASSWORD` | Apple Account app-specific password for notarization |

Never commit certificates or private keys. The workflow imports the certificate
into a temporary keychain and deletes the keychain and certificate file afterward.
Electron Packager signs nested helpers with its Electron entitlements and hardened
runtime. Signing has its own ten-minute step with verbose per-file diagnostics.
A separate step submits the application to Apple, prints its submission ID
immediately, and streams Apple's processing status with a twenty-minute wait limit.
The DMG uses the same submission/status process. Apple submission IDs, status and
available rejection logs are retained as workflow artifacts for seven days, including
on failure. A wait timeout does not cancel Apple's server-side processing.
The workflow staples the application and verifies the
signed inventory UI, creates a DMG with an Applications shortcut, signs/notarizes/
staples it, mounts it, and validates the contained application before publishing.
Signing, notarization, or Gatekeeper failures stop publication. Release assets
include the DMG and a `.sha256` checksum.

The workflow creates a tag at the exact triggering commit and publishes the
release only after the DMG and checksum have been uploaded. A rerun skips an
already published release for that commit, or resumes an incomplete draft using
the same version. After correcting credentials or a transient Apple service
failure, use **Re-run failed jobs** in GitHub Actions.

Protect `main`: merged code runs with signing credentials. After the first release,
download its DMG through a browser and confirm drag-to-Applications installation
and launch on a Mac.

### Real-device validation

For an explicitly selected real device:

```sh
export KVM_TEST_URL="https://YOUR-KVM"
export KVM_TEST_CERT_SHA256="VERIFIED:SHA256:FINGERPRINT"
read -rs KVM_PASSWORD
export KVM_PASSWORD
KVM_TEST_AUDIO=1 KVM_TEST_SECONDS=120 npm run test:live
unset KVM_PASSWORD
node scripts/summarize-results.cjs
```

The audio validation temporarily enables USB microphone emulation if disabled,
and restores the original disabled state afterward. It never enables a camera,
presses power controls, uploads virtual media, or joins an external meeting.
The test sends a nonprinting Shift modifier and non-clicking absolute pointer
moves. It waits for the firmware's debounced resize layout before checking
settled pointer coordinates. It does not validate every Retina/remote-resolution
combination or input while the resize animation is in progress.

## Investigation and remaining work

- [Feature parity and compatibility gaps](docs/feature-parity.md)
- [Protocol and architecture evidence](docs/investigation.md)
- [Measurements and limitations](docs/performance.md)
- [Validation results and remaining acceptance gates](docs/validation.md)
- [Implementation design](docs/superpowers/specs/2026-10-27-kvm-workspace-design.md)

The tested KVM currently reports **Tailscale disabled**. Its end-to-end tailnet
signaling/media path has therefore not been verified. Save its tailnet/MagicDNS
address after the existing device Tailscale installation is configured. This
application uses the OS's existing network connection and implements no VPN or
tailnet management.

GLKVM remains installed at `/Applications/GLKVM.app` for comparison.
