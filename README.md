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

## Run

The verified local installation is:

```sh
open "$HOME/Applications/KVM Workspace.app"
```

It has the provided KVM saved as **RM1PE — Home**. Real-device saved-login
restoration was verified with Keychain-encrypted tokens. Source builds start
with an empty inventory. The standalone `.app` needs no external Node.js or REA
installation to run.

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
verifies the full bundle. This is a local build, not a notarized distribution.

```sh
npm run test:inventory
npm run test:windows
```

The inventory check uses actual Add/Edit/Save/Cancel/Remove buttons in the
packaged application with a disposable profile and verifies restart persistence.
The window check exercises the **packaged application** with synthetic HTTPS pages,
including actual TLS, native windows, filesystem failures and Keychain-backed
token encryption. It does not represent three real KVMs.

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
