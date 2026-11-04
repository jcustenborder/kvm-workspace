# Device password editing and reliable automatic sign-in

## Goal

Manage administrator passwords in the workspace's Devices editor and use them
when opening device sessions. The user reports that automatic login has never
worked: the password field stays empty with an Authentication required badge.
Moving the editor alone does not establish that this failure is resolved.

## Approved interaction

- Add an optional masked password textbox below the addresses in the shared
  Add/Edit KVM dialog. Use the existing Save action to save a new password.
- Leave the textbox empty on opening the editor. Explain that leaving it blank
  keeps the saved password. Never read the existing secret into the editor.
- Provide a separate Remove saved password control, applied on Save; Cancel
  discards all pending edits. A nonempty replacement supersedes removal.
- Clear password input when the dialog closes, including after cancellation.
- Remove Session menu commands Save Password and Sign In and Forget Saved
  Password. Update instructions and errors to point to Devices → Edit.
- Saving does not open or disconnect a session. The password is used on the
  next login attempt; an existing login screen can be reloaded to retry.

## Storage and data flow

Reuse the existing native macOS Keychain service and stable device ID. Existing
passwords continue to work without migration. LAN and Tailnet share the device's
password. Inventory responses and files never contain passwords.

Pass the optional password update separately from persistent device details
through the inventory preload. Validate values and inventory sender in the main
process, and serialize credential operations with device removal and session
credential reads. Validate device details before credential changes. Surface
Keychain or inventory-write failures in the dialog; do not report a failed save
as successful or imply cross-store atomicity.

Retain current certificate verification, isolated session credential access,
token restoration ordering, manual fallback, and two-factor handling. No
password values belong in logs, error messages, or diagnostics.

## Automatic login investigation

The current badge merely detects a password input. The empty-field symptom does
not distinguish an absent Keychain entry from unrecognized firmware markup or
another early exit. Existing automated password validation uses a synthetic
firmware-shaped form; the live validation script manually fills the password.
The real-device root cause is not yet established.

Trace form recognition, credential lookup, input assignment, and submission.
Reproduce an observed failure before changing authentication logic and retain a
focused regression check for its cause. If real-device evidence is unavailable,
explicitly report that limitation rather than claim the user's failure is fixed.

## Success criteria and verification

- Exercise actual Add/Edit controls to save and replace a password, preserve it
  on a blank edit, remove it explicitly, and discard edits on Cancel.
- Verify opening a synthetic HTTPS session after an editor save fills and submits
  successfully, including reopening and sharing across configured routes.
- Verify Keychain failure leaves the editor open with an actionable error.
- Preserve rejection/no-repeat behavior, 2FA, device isolation, navigation checks,
  delayed credential handling, token ordering, and device-removal checks.
- Adapt existing password validation to the editor instead of removed menu
  commands; run unit tests and packaged inventory/password checks.
- Verify real-device automatic login when an explicitly selected device and
  credentials are available. Never use synthetic success as proof of that result.
