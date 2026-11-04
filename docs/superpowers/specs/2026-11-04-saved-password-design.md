# Saved device passwords and automatic authentication

## Approved behavior

Store one administrator password in native macOS Keychain per stable inventory
device ID. Names and LAN/Tailscale routes do not define credential identity.
Automatically fill and submit the device login page, revealing it when there is
no saved password, authentication fails, or two-factor authentication is needed.
Never retry automatically on the same login-page appearance.

## Implementation

- Use `@napi-rs/keyring`'s native Keychain binding. Passwords do not go into
  inventory JSON, encrypted token files, logs, shell arguments, or localStorage.
- Add **Session → Save Password and Sign In**. The user enters/pastes a password
  into the device login field and explicitly chooses this command to save or
  replace it and authenticate. Add **Forget Saved Password**, and delete the
  Keychain entry when removing a device.
- Bind entries to service `com.scarcemedia.kvm-workspace.password` and account
  `device.id`. Keep existing encrypted-token functionality.
- Recognize the deployed firmware's `/login` route and
  `.auth-form-container` with `input[name=passwd]` and `button.operation-btn`.
  Do not fill password-change, initialization, terminal, or remote-host fields.
- An isolated preload observes SPA navigation and login-form readiness. While
  authenticating, conceal the login container and show a local signing-in status.
  Expose no credential API to the device's main JavaScript world.
- Main-process credential reads require the owning session's main frame, exact
  selected HTTPS origin, and a still-configured address. Existing TLS certificate
  verification remains mandatory. Recheck the frame/origin after async reads.
- Restore existing tokens before attempting password login. Late credential
  reads must not fill a replacement document or overwrite user input.
- A failed submission, missing/locked Keychain, changed form, or 15-second
  timeout restores manual login. Report Keychain failures without secret values.
  A 2FA field receives no automatic submission; the user supplies the OTP.
- Credential save/delete operations serialize with existing per-device credential
  and removal operations. Changing addresses retains the password but requires
  the existing certificate verification for the new endpoint.

## Verification

Exercise the packaged Electron app against synthetic HTTPS firmware-shaped login
pages: successful hidden automatic login, failed-password fallback/no retries,
2FA fallback, SPA expiry, explicit replacement/forget, route sharing, device
isolation, untrusted IPC/navigation, delayed credentials, and deletion failures.
Use a replaceable native-store boundary in CI to avoid Keychain authorization
dialogs; separately run an opt-in real Keychain round trip. Verify the native
binding is unpacked and signed in the application bundle. Run existing unit,
inventory, and window validation. Real-device automatic authentication is not
claimed without an explicitly supplied test password.
