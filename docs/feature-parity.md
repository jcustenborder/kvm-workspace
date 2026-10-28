# Feature parity and compatibility matrix

**Evidence labels:** O = observed shipped/deployed code or authenticated device
state; R = exercised at runtime; U = unverified. “Available” means the actual
firmware interface is retained; it does not mean every destructive operation
has been performed. Protocol/source locations are in [investigation.md](investigation.md).

Tested pairing: GLKVM desktop **1.6.0**, KVM **RM1PE / 1.10.1 release2**, macOS
**26.6.2**, M4 Max. Only one physical KVM has been identified and tested.

| Feature / reference behavior | Dependencies and direct access | New application support / status | Concrete gap |
|---|---|---|---|
| Named device inventory and saved connections (O) | Address reachable through existing OS network | Persistent name + LAN + tailnet/MagicDNS address list; add/edit/remove (R) | Cloud-bound device inventory is not imported |
| Device discovery (partial O) | Reference exposes scan IPC names; inspected main has no matching scan handlers | Explicit saved addresses | Automatic LAN discovery not implemented; its actual reference behavior remains unresolved |
| Direct device login (O/R) | Device admin password; optional firmware 2FA | Actual device login UI, no GL.iNet account (R) | TOTP/device-approval variants not runtime-tested |
| Retained authentication (O) | Token expiry/revocation controlled by firmware | Optional Keychain-encrypted tokens; isolated volatile browser storage; explicit forget; real RM1PE login restored after application restart (R) | Long expiry/revocation and cross-route login revalidation remain |
| TLS trust | HTTPS/self-signed certificates common | Explicit fingerprint approval, endpoint-scoped persistence; cross-port exceptions blocked (R) | Certificate renewal requires new approval by design |
| Tailscale / MagicDNS | OS and device already joined/reachable; media ICE also must work | HTTPS tailnet/IP/MagicDNS endpoint support; ordinary OS networking | Tested KVM reports Tailscale disabled; complete tailnet media path U |
| Independent ordinary session windows | No firmware change required | One isolated window per saved device; no application-imposed total count limit (R, three synthetic windows) | Three distinct physical KVMs not available for acceptance test |
| Resizing / aspect ratio | Firmware player scaling | Retains actual player; resize does not reload connection; settled absolute HID points checked at 1280×800 and 900×650 with letterboxing, observed DPR 1 (R) | Retina DPR 2, remote-resolution changes and input during transition remain U |
| Background video | Hardware/network capacity | Background throttling disabled; frame counter advanced while unfocused (R) | Long multi-device active-use test remains |
| WebRTC H.264 video | Device codec/firmware | 1920×1080 ~60 decoded fps, VideoToolbox hardware path (R) | More resolutions/refresh rates and H.265 U |
| WebRTC(FEC), WebRTC(Native) | Firmware-specific components | Preserved in Transfer controls (O/available) | Per-mode audio/video/input qualification U |
| Direct video / WebCodecs | Secure context and supported decoder | Preserved as optional firmware mode; explicit no-audio warning (O/available) | Not a call-capable substitute; canvas liveness not monitored |
| Remote speaker audio | Host HDMI/audio capture plus WebRTC | Inbound Opus verified simultaneously with outgoing mic (R) | Speech quality, A/V sync and actual meeting U |
| Local microphone forwarding | USB microphone emulation enabled on KVM; OS permission | Explicit per-session permission and local input picker, outgoing Opus (R) | Live input hot-swap requires restarting audio capture |
| Audio-device selection | Enumerated devices/platform permissions | Per-window local speaker selector; mic selection per capture | Physical device unplug/replug and non-default speaker selection need hardware validation |
| Mute / press-to-speak | Firmware configuration; USB mic | Native firmware controls retained; host emits keyup on blur (O; actual modifier release R) | Actual configured PTT key/hold workflow and speech test U |
| Focus-independent call routing | Separate input/media state | No focus-based microphone destination or ordinary mute changes; audio RTP continues unfocused (R) | Sustained call while using two other real KVMs U |
| Echo processing | Existing client requests no EC/AGC/NS | Preserves requested constraints, no duplicate processing (O) | Same-room acoustic echo and intelligibility U |
| Camera forwarding | Model/firmware/USB resource limits; documented FEC/browser requirements | Camera-capable firmware UI retained; explicit per-session OS permission path | Disabled on tested device; actual operator usage and forwarding U |
| Layouts/modifiers/special keys | Browser key events and firmware HID mapping | Firmware controls retained; actual Shift down/up packets verified on focus loss (R) | Full keyboard-layout matrix/BIOS/remote Escape U |
| Text paste | Firmware text-to-HID layout; clipboard permission | Firmware paste UI and normal edit menu; explicit clipboard-read grant | Multiline/layout-specific live paste U |
| Absolute pointer | Firmware letterbox-to-HID mapping | Original player mapping retained; actual non-clicking HID packets match three contained-video points before/after resize at observed DPR 1 (R) | Full end-to-end cursor grid, Retina and resolution changes U |
| Relative pointer / capture | Browser pointer lock, OS shortcut restrictions | Firmware option and release controls retained | Live relative/BIOS mouse test U; macOS-reserved shortcuts remain local |
| Input cleanup | Firmware HID and per-window state | Host key/button tracking, blur/key-up/close cleanup, no host input replay (R for modifier; synthetic isolation) | Disconnect-during-button-drag on real host U |
| Reconnect / failure | Firmware session/signaling | Explicit per-window reconnect; capture grants reset on document replacement; no cross-window reload (R synthetic) | Long real network loss/auth-expiry recovery U |
| No-signal/auth/stalled output | Device state plus frame updates | Device states retained; explicit authentication/wait/no-recent-frame indicator | Direct canvas liveness U; static screens can legitimately produce no new frames |
| Virtual media / file transfer | USB gadget/storage resources and firmware | Complete device Virtual Media UI, browser uploads/downloads available | Actual image mounting, USB host visibility, file-transfer integrity U |
| USB functions | Device endpoint capacity and host enumeration | Firmware USB interface retained; mic toggled with other flags verified unchanged and restored (R) | MTP/camera/storage combinations U |
| Power / ATX / Fingerbot / WoL | Actual model and attached accessory; Comet Q differs | Device Accessories/Toolbox controls retained | No power/reset action issued; accessory identity and operation U |
| Device settings / EDID / upgrades / apps | Model/firmware-specific, often device-global | Actual firmware UI retained, including Apps Center | Mutating settings/upgrade/accessory combinations U |
| Web terminal / auxiliary tools | Firmware offers tool URL | Same-origin auxiliary windows retain the session without replacing video; owner closes tools (R synthetic) | Actual terminal command flow U |
| Screenshots / home previews | Firmware screenshot/browser download flow | Firmware screenshot UI available | Desktop inventory screenshot thumbnails not implemented |
| Language/theme | Device browser UI and settings | Firmware language/theme controls retained; compact dark inventory | Full desktop-global appearance synchronization not cloned |
| Desktop self-updater | Separate distribution infrastructure | Reproducible manual build and local signed app | Automatic desktop updating not implemented |

USB functions, stream encoder configuration, EDID and physical power state are
**device-global**, even if several clients connect to the same KVM. Browser
isolation does not make one physical USB controller independent of itself.
Normal use with distinct KVMs keeps these settings on their respective devices.

Cloud replacement, VPN/tailnet-management UI, tiling, snapping, saved layouts and
monitor-specific window management are intentionally outside the requested scope.
