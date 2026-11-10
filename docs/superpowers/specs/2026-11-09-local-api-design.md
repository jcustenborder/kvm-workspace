# Local session API

Approved in conversation on 2026-11-09 for implementation and a pull request.

## Contract

The Electron app serves HTTP on `127.0.0.1:53241` while running. Every endpoint,
including `GET /openapi.json`, requires a generated, persistent bearer token.
Store it in an owner-only file under Application Support; provide a Copy API Token
application-menu action. Reject browser Origin requests and non-local Host headers.
Report startup failures without terminating the desktop app. No new dependencies.

Device names universally use unique DNS labels: 1–63 lowercase ASCII letters,
digits or hyphens, with alphanumeric ends. Enforce on every add/edit. Preserve
legacy inventory for manual renaming, but reject targeting invalid/ambiguous names.
Keep internal IDs, Keychain identities, pins and preferences intact. No migration.

| Method | Path | Behavior |
| --- | --- | --- |
| GET | /openapi.json | OpenAPI 3.1 with authentication, bodies, responses and errors |
| GET | /sessions | All saved devices, including closed sessions |
| GET | /sessions?state=open | Only open sessions |
| GET | /sessions/{name} | One session |
| POST | /sessions/{name}/start | Required route: lan or tailnet |
| POST | /sessions/{name}/end | Release input and close window |
| POST | /sessions/{name}/focus | Show, restore and focus window |
| POST | /sessions/{name}/send-keys | Browser codes, e.g. MetaLeft + KeyD |
| PUT | /sessions/{name}/speaker | Set enabled boolean and persist |
| POST | /sessions/{name}/speaker/toggle | Toggle and persist; return confirmed enabled boolean |

Session representations contain name, state (open/closed), route (or null), and
speaker.enabled (boolean or null). Speaker state is observed from the firmware,
never inferred from saved intent. Manual changes are visible on subsequent reads.
Lists include legacy names so users can discover and repair them.

Start uses existing TLS approval and saved-login behavior. Same-route starts and
closed-session ends are idempotent; different-route starts conflict. An open window
does not imply authenticated/connected firmware. Commands require a ready, matching
main-frame device page. Keys are pressed together and released in reverse order,
without focusing the native window. Validate the supported code set before sending.
No arbitrary JavaScript or OS keyboard injection is exposed.

Serialize mutations per device, including toggles. Bound bodies and execution waits;
reject malformed input before any action. Return JSON errors: 400 invalid request,
401 unauthenticated, 403 disallowed origin/host, 404 missing device/path, 405 wrong
method, 409 closed/unready/conflicting session, 413 oversized body, 500 internal or
persistence failure. A failed/unconfirmed operation must not claim success.

## Verification

Node tests exercise actual HTTP routing, auth, validation, token persistence and
OpenAPI responses. Model tests cover naming, uniqueness and legacy recovery.
Synthetic Electron checks exercise lifecycle, background keys, modifier release,
focus restoration, live speaker reads, confirmed changes, persistence and errors.
Real remote Windows shortcut delivery remains a hardware acceptance check.
