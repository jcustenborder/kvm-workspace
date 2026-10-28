# GLKVM investigation and architecture findings

## Identity and evidence boundary

- Installed reference: **GLKVM 1.6.0**, bundle `com.glinet.kvmdesk`,
  `/Applications/GLKVM.app`. Electron, universal Mach-O with arm64 available.
- Execution/target Mac: **M4 Max**, 16 CPU cores, 128 GB RAM, arm64,
  macOS **26.6.2 (25G83)**. Swift 6.4 and Xcode developer tools available.
  The operator corrected the initial M5 description to M4 Max.
- Real device: **RM1PE**, **V1.10.1 release2**, SoC declaration `rv1126b`.
  Identity was read from authenticated `/api/upgrade/version` and
  `/api/system/capability`, not inferred from marketing documentation.
- REA **6.8.0** CLI, using its bundled reverse-engineer-anything workflow.
  REA MCP tools were not exposed in the active coding session; CLI analysis
  does not establish a live MCP connection.

REA retained records (large complete bundles are local under the ignored
`investigation/evidence/` directory):

| Record | REA Evidence ID |
|---|---|
| Reference bundle plist | `ev_97762b9709e74fd2d7227c080fddc7289e246d10c18d3045bd59795eecba7864` |
| ASAR main/preload static analysis | `ev_af037f3c1d022e28fe56bc596defb76d41e229c08dfd6fbfce6912001e25f073` |
| ASAR remote renderer analysis | `ev_7608fff0c14cc417bcd20bd98a537da1d7287edaa9f267a0610421dfe6c5d3a3` |
| Deployed device web client | `ev_0d6ad0e3d8dbeafd92dcdc3c9c8187649c0a6128542309d61b489bb0f4e7e27d` |
| Existing native Session Control window, AX observation | `ev_3d3798d01844c2cd5beab89708f68a8bce5161a6bd54ec73827c7bac450d3c7c` |

These are selected-source static analyses, with explicit partial graph coverage.
They do not establish execution of every branch or compatibility of unselected
code. The AX observation confirmed the selected running window identity but
exposed little renderer detail. No disassembler was needed for the relevant
Electron/firmware code; the native reference was not patched or restarted.

## Shipped code observations

Paths below are relative to `investigation/extracted/`. Extracted reference
files are investigation inputs, excluded from the replacement package.

**Desktop ASAR SHA-256:**
`2418338162d59d8d43d78575679a63dbe8078e0bd7949769a30e73d19e1cf9a7`.

- `out/main/index.js:58890–59041`: a singleton `remoteWindow` receives every
  device via `openRemotePage`. There is no inherent transport requirement for
  one shared window.
- `out/renderer/assets/remote-yZG4sGWu.js:3123–3133`: each session embeds the
  device's actual HTTPS UI in an iframe, granting pointer-lock and media
  capability. `:3184–3198` hides unselected sessions with `vShow`.
  `:3239–3278` constructs the device tabs.
- `out/main/index.js:59682–59692`: startup calls
  `disableHardwareAcceleration()` and adds GPU-disabling switches. This is
  observed configuration, not proof of a particular runtime decoder choice.
- `out/main/index.js:58950–59010`: the reference accepts session certificates
  and rewrites cookie properties. The replacement instead uses approved
  endpoint pins, browser isolation, and leaves cookie protections intact.
- `out/renderer/assets/remote-yZG4sGWu.js:2816–2875`: per-device tokens live in
  shared Electron storage and are used to initialize `auth_token` cookies.
  The replacement uses optional Keychain-encrypted retained tokens.
- `out/main/index.js:58205–58562`: desktop key blocking/focus state is shared;
  the observed native key-blocker helper is Windows-specific.

The reference profile contained six token records and no saved direct-access
records. Only shapes/counts were reported; token values were not written to
investigation reports. This does not establish that six devices are currently
reachable or that the provided RM1PE is the user's conference-call device.

## Deployed device protocols

File `device/index-CwiW8WCN.js`, SHA-256
`35b7301bcaaa42256081b6d37c28f23bdefa5142ae712f600bbbfda0a84cd7a1`.
Offsets are zero-based UTF-8 byte offsets in the original minified file.

| Finding | Observed source location / runtime evidence |
|---|---|
| Multipart login, HTTP token header, WebSocket auth query | offsets 407222–407426, 406847, 5642–5793; real login succeeded |
| Janus WebRTC at `/janus/ws`, `janus.plugin.ustreamer`, SDP watch/start | 396542, 394528; real H.264 WebRTC connected |
| WebRTC(FEC), `/pion/ws`, base64 JSON SDP, negotiated ordered HID data channel id 1 | 804605, 808432, 806002; source observed, this mode not runtime-qualified |
| WebRTC(Native), `/lws/ws`, raw SDP offer/answer and ICE | 815546; source observed, not runtime-qualified |
| Direct, `/api/media/ws`, WebCodecs and canvas, no speaker/mic | 778876, 855611; source and official documentation agree |
| TURN configuration from `/api/turn/get_turn`, ICE policy `all` | 378227, 355484–355643; credentials excluded from reports |
| Speaker is a separate audio element/session; video element is muted | 825163, 829241; inbound/outbound Opus counters verified simultaneously |
| Existing capture constraints: 48 kHz, 16-bit requested, echo cancellation/AGC/noise suppression disabled | 393081; replacement preserves these requests and adds no processing chain |
| Microphone requires USB enablement and explicit unmute | 822283, 865791; real microphone enable/unmute tested |
| USB microphone update sends only `enable_mic` as query parameters | 378872–379009, 838289; all other USB flags compared unchanged in runtime test |
| Element blur releases pressed keys; mouse/PTT have additional release risks | 823051, 363054, 730496, 290668; host cleanup added; actual Shift down/up packets verified |
| Absolute pointer mapping uses event-target-relative coordinates, rounded video layout dimensions and signed 16-bit range | 727369–729293, 400926–401677; settled actual packets checked at two window sizes/DPR 1; full Retina/remote-resolution verification remains |
| Relative pointer uses pointer lock and sensitivity-scaled signed 8-bit deltas | 728523; functional live relative-mode test remains |
| Native microphone/output picker absent from inspected firmware entry bundle | source uses default `getUserMedia` at 809366/816414; no `setSinkId` call found in the inspected bundles |
| Tailscale read-only status and login state | 485790–486057: `/api/tailscale/status`, `/api/tailscale/login_status`; tested device reports `running:false` |
| HUD P2P/Relay comes from ICE candidate types, initially defaults to Relay | 389419–391985; not synonymous with Direct video mode |

Firmware vendor companion `main-sN32-4AN.js` SHA-256:
`911d104516a3823da7bd3bee1fc6f1eedb69bd2bb847350364f993f1630d82d5`.
Its multipart conversion is at byte offset 182436.

### Networking conclusions

**Observed:** authenticated HTTP control, WebSocket signaling, video RTP and
two-way audio RTP work to the selected LAN KVM. Selected ICE candidates in the
last run were host/UDP with remote private-LAN addresses, not a TURN relay.

**Inference:** replacing the address with a reachable tailnet endpoint preserves
the origin-derived signaling URLs. ICE can still select LAN, tailnet or relay
candidates independently, so an HTTP page load or origin change proves nothing
about the final media path. The device's Tailscale-disabled state prevents an
honest tailnet-only test now.

**Unknown:** off-home candidate reachability, tailnet-only audio/video recovery,
other device firmware capabilities, actual call intelligibility/echo and camera
usage in the operator's existing multi-device workflow.

### Settings and resizing boundary

The deployed client stores video quality/mode/codec, keyboard keymap, relative
sensitivity and PTT through GET `/api/system/get_config` and POST
`/api/system/set_config` (byte offsets 407845–407965). Thus normal config
hydration preserves these preferences even with volatile browser partitions.
Theme/language have nonsecret browser fallback mirrors. Speaker-on and mic-mute
state initialize in memory; the replacement does not silently restore an
unmuted microphone.

The client reapplies saved quality at player startup. A failed config read can
still mark initialization finished with default-backed values (369048–369108);
that inherited firmware failure path has not been qualified. The measured run
reported saved quality 1 (Medium), WebRTC, video format 0, smart encoding and
quality-first processing. No low-quality override was applied for measurement.

Native resize reaches the firmware through a 300 ms trailing-debounced layout
watcher (291452–291870), and `#stream-window` has 0.3-second size transitions.
Mouse positions are staged at event time and normalized on an approximately
10 ms send loop using then-current rounded media layout dimensions. The live
wire test checks settled layout after this debounce/transition; it does not
claim frame-accurate input during the animation. Packets were correlated with
their actual originating mouse event rather than treating an unrelated later
packet as the requested point.

## Architecture decision

1. **AppKit/WKWebView feasibility probe:** a real packaged arm64 probe logged in
   to this device and displayed 1920×1080 video. Frame callbacks advanced from
   205 to 743 over the 10–25 second sample. WebKit's playback-quality frame
   counter stayed zero, so it was not treated as evidence of absent playback.
   This probe denied capture by default and did not qualify full-duplex calls,
   input fidelity, or full process-tree memory use. WebKit was not ruled out.
2. **Accelerated Electron host (selected validation implementation):** preserves
   the installed app's Chromium/device-client compatibility, while replacing
   its singleton/tab policy with ordinary isolated windows. The packaged app
   has passed actual hardware video, HID release and duplex Opus transport;
   `VideoToolboxVideoDecoder` and power-efficient decoding were observed.
3. **Native AppKit + libwebrtc/VideoToolbox:** still plausible, but would require
   porting/qualifying multiple signaling, HID, USB and firmware UI paths. No
   evidence yet justifies that larger compatibility effort.

Selection is based on verified compatibility plus an efficient established media
path, not a claim that Electron is intrinsically fastest. The app performs no
per-frame native/frontend IPC, transcoding, custom codec work or UI-thread media
decoding. Firmware updates can change behavior; loading the device client keeps
its protocol implementation paired with its own server, while still requiring
requalification of host integration and permissions.

## Public-source boundary

[gl-inet/glkvm](https://github.com/gl-inet/glkvm) is KVMD/browser/firmware-side
source, not the installed macOS desktop app's full source. Reviewed main commit:
`3e8dd23c4bd638a4650433664cc3b0f3b4d29395` (labeled 1.10.0). Its internal version
declarations differ, and it does not establish the deployed 1.10.1 release2
artifact's exact bytes. The public source is GPLv3; it references additional
components such as `gl-pion`, `webrtc_client` and `rkipc` that are not fully
implemented there. Findings about the installed desktop and deployed device use
their own artifacts, rather than assuming repository/version identity.

Official references:
[application](https://www.gl-inet.com/pages/app-rm),
[KVM docs](https://docs.gl-inet.com/kvm/en/),
[Tailscale access](https://docs.gl-inet.com/kvm/en/faq/remote_access_via_tailscale/),
[console audio/camera](https://docs.gl-inet.com/kvm/en/user_guide/gl-rm10/console_guide/#audio-camera).
The documented RM10 camera route requires firmware 1.10+, WebRTC(FEC), and browser
access; that does not prove RM1PE camera readiness or that the operator uses it.
