# Remember sound output per KVM

## Approved behavior

Remember whether the user enabled sound output for each saved KVM. Restore that
choice after a page reconnect, closing and reopening the KVM window, and quitting
and restarting the application. An explicit off choice persists too. Devices
without a saved choice retain the firmware's default behavior.

This remembers output on/off, not the selected local output hardware. Microphone
and camera capture remain manual.

## Existing behavior and integration

Device pages run in isolated, in-memory browser partitions, cleared on window
closure. Persist the preference in the application's existing inventory storage,
keyed by stable device identity, so LAN and tailnet share the same choice.
Preserve it when editing a device and remove it when deleting that device.
Accept older inventories with no preference; reject malformed saved values.

The inspected firmware initializes `configState.volumeOn` to false. Its speaker
control calls `setVolumeOn` independently of microphone mute state, and the
firmware creates its own audio session when output is enabled. Reuse that
speaker control rather than implementing another WebRTC connection or changing
microphone state. The status control has the class `volume-icon` and distinct
`gl-kvm-sound-full` and `gl-kvm-sound-off` icons. Confirm the rendered state
representation before implementing detection.

Use the isolated session preload to read the saved preference and observe the
firmware's output state. Restore only after authenticated WebRTC video is ready
and the speaker control's state is recognizable. Apply a saved choice once per
page, then persist subsequent changes. Do not save startup's default off over a
remembered on. Do not interpret teardown, temporary disconnection, or Direct
mode's forced audio disablement as an explicit off choice. Restore output when
returning from Direct mode to a usable WebRTC session without changing video
mode automatically.

Any preference IPC must validate the sending session, main frame, selected
origin, and boolean value. Expose no general native API to device pages. Report
storage failures through the application's existing error reporting. If firmware
controls cannot be recognized, leave them alone and report that restoration was
unavailable rather than toggling an unknown control.

## Verification / success criteria

- A remembered on preference restores output after reload, window reopen, and
  app restart; an explicit off remains off.
- A second KVM without that preference is unaffected.
- Startup defaults and session teardown do not overwrite saved intent.
- Editing a device preserves the preference; deletion removes it; old inventory
  files still load; invalid values and unauthorized IPC are rejected.
- Restoration does not request microphone/camera capture, unmute a microphone,
  or change USB emulation settings.
- Direct mode does not erase the preference or trigger repeated toggle attempts.
- Use existing Node tests for persistence/validation and a synthetic Electron
  page for output controls and lifecycle behavior. Run the existing test suite.
  Real firmware sound reconnection requires a reachable KVM; report separately
  whether that check was possible.

## Scope

No new dependency, global audio preference, microphone restoration, local
speaker-device persistence, or replacement media transport.
