# Validation results and acceptance gates

## Verified

- Apple Silicon `.app` builds with pinned dependencies; local full-bundle code
  signature verification is part of packaging.
- Installed separately at `~/Applications/KVM Workspace.app`. The provided
  RM1PE LAN record is saved; real login was encrypted, the app was closed, and
  fresh-process device access restored live video without re-entering a password.
- Unit checks cover endpoint validation, credential-free device records, no
  arbitrary inventory limit, origin boundaries, exact pins, corrupted persisted
  state, and serialization of failed/pending credential work.
- Packaged inventory-button regression covers both Add KVM buttons, cancel,
  save of LAN/tailnet addresses, edit, full-application restart persistence,
  removal, and working handlers after reload. It reproduced and caught the
  classic-script/global API name collision; the inventory now loads as a module.
- Packaged synthetic HTTPS-window tests cover independent native windows,
  browser storage, no remote native bridge, pre-document capture-wrapper install,
  cross-port TLS boundary, route conflicts, atomic-write failure rollback,
  held modifier release without broadcasting, resize/reload isolation, close/
  reopen cleanup, auxiliary-window teardown and retryable credential deletion.
  Synthetic pages are not presented as three real devices.
- One real RM1PE: password authentication, WebRTC H.264 1920×1080, observed
  VideoToolbox power-efficient decoding, continued unfocused video, actual binary
  HID `ShiftLeft` down and release on native window blur, and simultaneous
  incoming/outgoing Opus RTP with the microphone explicitly selected/enabled for
  two minutes. Three non-clicking absolute pointer points were checked before
  and after resize/letterboxing at observed DPR 1, after layout settled.
- USB microphone was temporarily enabled through the actual firmware UI. Other
  USB function flags were compared unchanged; the original disabled microphone
  setting was restored after each successful test. The harness contains an
  error-cleanup path; deliberate post-enable failure recovery has not been
  exercised on hardware.
- Real native WKWebView feasibility probe authenticated and produced advancing
  video frame callbacks. It did not qualify capture or the complete native approach.

## Concrete remaining acceptance gates

1. **Tailnet path:** this RM1PE reports `/api/tailscale/status` `running:false`.
   The Mac's existing Tailscale is running, but that alone does not connect this
   KVM. Obtain a reachable configured device tailnet/MagicDNS endpoint and verify
   actual ICE/video/audio when the LAN path is unavailable.
2. **Three physical KVMs:** only one operator-selected device is available in the
   current evidence. A previously KVM-named tailnet peer was offline/expired;
   that does not identify the operator's other two machines. Test three actual
   device records in independent visible windows, not aliases of one device.
3. **Actual conference:** test sustained authorized conversation through one
   controlled machine while interacting with the other two and local apps.
   RTP transport success does not establish echo, speech quality, sync, or
   end-to-end conversational delay. No meeting address or active call was used.
4. **Input coverage:** BIOS/OS special keys, multiple layouts, paste, full absolute/
   relative pointer grids, Retina/remote-resolution changes, input during the
   firmware's resize transition, capture release
   while dragging, and network-loss cleanup need real-host verification.
5. **Applicable accessories/media:** discover actual accessory models and test
   virtual-media/file integrity, USB combinations, ATX/Fingerbot/WoL and settings
   without assuming generic models behave identically. Interfaces are present;
   no power action, firmware upgrade or virtual disk mount was issued.
6. **Audio/camera devices:** test non-default local devices, output routing,
   unplug/replug and existing configured PTT. Microphone changes take effect on
   the next capture; seamless live input hot-swap is not implemented. Camera is
   disabled on this KVM; use by the operator on other KVMs remains unknown.
7. **Long-run resources:** collect controlled, matched GLKVM baselines and
   one/two/three-device resource measurements, including all helper processes.
   The existing reference app remains installed for this comparison.

The request's complete replacement acceptance criteria have **not** all passed.
This build is a useful, runnable multiwindow validation application with the
firmware's full control surface retained, and an explicit remaining test/feature
ledger rather than a claim that a streaming prototype finishes the assignment.
