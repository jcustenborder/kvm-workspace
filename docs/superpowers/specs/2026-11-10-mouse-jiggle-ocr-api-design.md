# Mouse Jiggle and OCR local API design

## Contract

Extend the authenticated loopback API with two controls backed by the device
firmware UI already rendered in each session window:

- `POST /sessions/{name}/mouse-jiggle/toggle` toggles Mouse Jiggle once and
  returns `{"enabled": true|false}` after observing the resulting switch state.
- `POST /sessions/{name}/ocr` triggers the firmware OCR button once and returns
  `{"triggered": true}` after observing that the native OCR interface opened.
- Session responses include `mouseJiggle: {"enabled": true|false|null}`. `null`
  means the rendered state is unknown or unavailable and is never treated as
  false.

Both endpoints require bearer authentication and retain the existing loopback,
Host, Origin, device-name validation, and per-device serialization rules. They
require an existing ready session and never start, focus, or reconnect one.

## Device integration

The session window loads the device endpoint directly. Extend the existing
sandboxed browser-only `sessionAction()` mechanism rather than adding host-side
mouse movement or calling undocumented firmware configuration APIs.

Inspect the live firmware DOM before selecting controls. Mouse Jiggle state must
come from the rendered switch's current semantic or class state. A toggle reads
that state, dispatches exactly one click, then polls for the opposite observed
state within the same bounded confirmation window used by Speaker. Missing,
disabled, ambiguous, or unchanged controls fail explicitly.

OCR locates the existing firmware OCR control, dispatches exactly one click,
then confirms the firmware OCR interface appeared. Missing, disabled, or
unconfirmed controls fail explicitly. The API does not extract or return OCR
text.

Document the firmware version and transfer modes verified during live DOM
inspection. Other markup or modes are unsupported unless their state and
confirmation signals are recognized; reads return `null` and commands fail.

## API and errors

Add both POST routes to the existing router and empty-body schemas. Preserve all
existing routes and response fields. `sessionInfo()` reads Mouse Jiggle alongside
Speaker while the session is open and same-origin; observation failures produce
`null` without hiding failures from mutation endpoints.

Commands continue through `apiCommand()` and its stable-device serial queue.
Closed sessions, sessions changing lifecycle, unready pages, unsupported modes
or firmware, unavailable controls, and failed confirmation return explicit 409
responses. Unexpected execution failures retain the existing sanitized 500
response and application logging. Neither command retries a click.

## Verification

Use test-driven development. Extend HTTP API tests for routing, empty-body
validation, authentication, response schemas, and OpenAPI paths. Extend the
synthetic Electron validation page with firmware-shaped Mouse Jiggle and OCR
controls and assert:

- observed Mouse Jiggle state appears in list and named-session responses;
- both toggle directions return the confirmed result;
- manual state changes are observed rather than replaced by requested state;
- closed, unready, unsupported, disabled, and unrecognized states report null
  on reads and explicit errors on commands;
- failed Mouse Jiggle confirmation and failed OCR opening return errors without
  a second click;
- OCR success returns `{"triggered": true}`;
- concurrent commands remain serialized per device;
- authentication, Host, and Origin protections cover the new routes.

Update OpenAPI and README endpoint/session documentation. Run `npm test` and
the applicable synthetic API validation. Report any live-device checks that
cannot be run rather than inferring support.
