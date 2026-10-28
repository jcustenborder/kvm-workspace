# KVM Workspace: investigation-backed implementation design

## Contract

Build a separate arm64 macOS application for an M4 Max. Keep GLKVM installed.
Maintain named devices with LAN and tailnet addresses. Open each session in its
own ordinary resizable window without an application-imposed count limit.
Preserve device controls and full-duplex call media; focus must never select a
microphone destination. Three real KVMs plus a sustained call are the acceptance
workload, not an imposed connection limit.

## Observations and approach comparison

GLKVM 1.6.0 is an Electron host embedding the device web UI. Its main process
owns one remote window; its renderer hides nonselected device iframes. It also
explicitly disables hardware acceleration. The reference's remote control UI
comes from the device rather than the desktop ASAR.

The available device is RM1PE firmware 1.10.1 release2 at the operator-selected
LAN endpoint. Browser observation confirms live 1920x1080 WebRTC H.264 video.
Microphone forwarding and call stability have not yet been tested. The device's
self-signed TLS certificate is also expired; trust requires explicit per-device
approval and fingerprint matching, never global certificate bypass.

1. **AppKit + WKWebView:** small host using system WebKit. Attractive memory
   baseline, but deployed firmware feature support, capture, relative input, and
   full-duplex audio require a packaged-app probe; browser success is insufficient.
2. **Electron + independent device BrowserWindows:** highest protocol/UI fidelity
   to the installed app; preserves the device's actual browser client without
   recreating undocumented transports. Test acceleration enabled and account for
   every renderer/GPU/utility process. Selected initial implementation candidate.
3. **AppKit + native libwebrtc/VideoToolbox:** credible performance route but a
   larger signaling, HID, USB, and settings compatibility effort. Only pursue if
   measurements invalidate the simpler complete browser-client path.

This is a candidate selection, not a measured claim that Electron is fastest.
No media quality reduction or background-session suspension is allowed.

## Application structure and data flow

A compact local inventory window stores nonsecret named-device records atomically
in the application's own support directory. Each device has optional LAN and
tailnet addresses. Opening a chosen address creates an isolated, in-memory
Chromium session and one top-level window loading that device's actual UI. Each
window owns its media, input, network state, navigation and cleanup. The window
manager must not group sessions into tabs. Resizing changes presentation only.

Use sandboxed renderers, context isolation, and no Node integration for remote
content. No application IPC is exposed to device pages. Allow privileged local
inventory IPC only from its exact bundled document. Restrict navigation,
permissions and certificate approvals to the selected device origin. Download
and upload workflows remain available. Microphone/camera permissions require
explicit per-session user action, independent of focus, and close/reconnect
must reset grants. Retained credentials/tokens belong in macOS Keychain via the
platform-provided Electron safeStorage facility; never in logs or plain JSON.
Do not retain credentials until a verified implementation supports this safely.

Load the device UI rather than copying proprietary desktop code. This preserves
control labels/grouping and firmware-specific functionality but inherits firmware
browser behavior; independently verify it and document every gap. Cloud account,
VPN implementation, snapping, layouts and window-manager integrations are out of
scope. LAN/tailnet fallback must not replay authentication or input implicitly.

## Media, input, and errors

Keep media inside Chromium's WebRTC decode/render path; no per-frame host IPC,
custom codec, transcoding, or timer-driven redraw pipeline. Disable background
throttling for session windows. Permissions and audio state must not follow
keyboard focus. Explicit capture releases input on blur/disconnect; firmware
behavior is to be audited before claiming this works. Never replay stale input.

Surface load failures and certificate errors. Device-owned no-signal/session-
expiry states remain visible. Add actual media heartbeat/queue metrics after
inspecting the firmware's client; page-loaded is never equivalent to live media.

## Verification and completion gates

- Test endpoint normalization, private/saved addresses, persistence, certificate
  pin matching, sender validation, permission scope, and session cleanup logic.
- Build an arm64 packaged release app; test actual capture permission and media.
- Verify one real device: login, video, HID, two-way audio, selected microphone,
  remote Escape, blur release, resize mapping, expiry/reconnect.
- Verify three different devices: call uninterrupted through focus/resize and
  independent failures; report unavailable devices rather than simulate results.
- Measure full process-tree CPU/RSS, launch/first frame, WebRTC fps/drops/queues,
  codec and decoder implementation at matched quality. Set budgets from results.
- Keep a parity matrix and evidence ledger. A running shell or video-only
  milestone is not completion of the requested replacement.

The operator has authorized reversible implementation without repeated general
design confirmations. Missing device addresses, call routing, microphone choice,
or access requiring human authorization remain focused questions.
