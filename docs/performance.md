# Performance observations

## Conditions

- M4 Max, 16 CPU cores, 128 GB RAM; macOS 26.6.2, native arm64.
- Packaged application, Electron 45.1.0 / Chromium 156.0.8078.49.
- One real RM1PE, firmware V1.10.1 release2, LAN HTTPS control/signaling.
- H.264 1920×1080, roughly 60 fps, firmware smart/dynamic encoder settings;
  no downscaling of the transmitted resolution. Opus audio in both directions.
- Native session window resized to 900×650 and unfocused while audio remained
  enabled. macOS/inventory focus was separate from microphone routing.
- Saved firmware profile: Medium quality (`stream_quality:1`), WebRTC,
  H.264/video format 0, smart encoding, quality-first processing, orientation 0.
- Playwright/Inspector/CDP and lightweight peer/HID observation hooks were used
  for measurement. Their overhead is included, not independently subtracted.
- Existing GLKVM and other user applications were not closed. This is a short
  feasibility/regression sample, not an isolated or statistically powered benchmark.

## Last measured sample

Raw, credential-free counters are retained locally in
`investigation/private/live-lan-audio.json`. The following values were computed
by `node scripts/summarize-results.cjs`, for the run ending
**2026-10-28T19:05:15.879Z**. Measured application ASAR SHA-256:
`6af294e843f002009078ef2f6a9793bd119916dfcd48f28865ad4b640794d011`.

| Measurement | Observation |
|---|---:|
| Open request through automated login to first usable frame | 5,455 ms |
| Unfocused/resize observation interval | 120.938 s, 13 samples |
| Decoded frame rate across interval | 60.00 fps |
| WebRTC decoder drops across interval | 0 |
| HTML playback drops across interval | 66 |
| Decoder | `ExternalDecoder (VideoToolboxVideoDecoder)` |
| `powerEfficientDecoder` | `true` |
| Incremental mean video jitter-buffer residence | 0.52 ms |
| Mean audio jitter-buffer residence | 51.92 ms |
| Sum of all app process working sets while streaming | 839.5 MiB |
| Sum three seconds after closing the session | 569.0 MiB |
| Sum of Electron-reported CPU percentage fields | 1.4543 |

**Inventory startup correction:** the earlier 309 ms figure measured only the
presence of the Add KVM element, not functioning controls. An inventory script
scope collision prevented initialization in that build, so that interactive-
startup claim is withdrawn. After fixing the scope, the packaged UI regression
measured **1,863 ms from launch through clicking Add KVM to a visible editor**
(one instrumented run). This is separate from the historical media run above.

The process totals include Browser, GPU, inventory/device renderers, network and
audio/other utility processes. Working-set sums count shared pages more than
once and are not unique physical-memory measurements. CPU is recorded in
Electron's own units without silently equating its normalization to Activity
Monitor's per-core percentages. First-sample CPU zeros are API warm-up, not idle
CPU measurements.

Video and audio jitter-buffer residence are **not** glass-to-glass, input-to-
photon, conversational latency, or lip-sync measurements. HTML presentation
drops and decoder drops are different counters; neither was hidden. Earlier
runs under different background/network conditions had substantially more
presentation drops, so the final interval is not presented as universal behavior.

Audio transport received 18,138 bytes of Opus RTP and sent 448,571 bytes while
unfocused, with the local audio track enabled and live. Remote silence/comfort
noise and local microphone data are not proof of intelligible speech or a call.
No external conference was joined.

## Framework feasibility

A separately packaged AppKit/WKWebView probe also authenticated and produced
1920×1080 video. Its frame callbacks advanced from 205 at 10 seconds to 743 at
25 seconds; WebKit's reported quality counter remained zero. It did not test
full-duplex capture or measure full WebKit helper-process resources. Its callback
rate cannot honestly be treated as a matched decoder-throughput comparison.

Electron was selected for this validation build because its **packaged** hardware
video and two-way audio paths were actually qualified and it matches the
reference client's engine. There is no measured claim that it beats a fully
qualified native/libwebrtc implementation.

## Reference comparison limitation

A snapshot of the already-running GLKVM process tree showed six processes,
including GPU and two remote-related renderers. One snapshot included roughly
78.5% CPU in its GPU helper and 11.7% in one renderer according to `ps`; its
selected devices, stream quality, background activity and accumulated uptime
were uncontrolled. These numbers are **not** a valid comparative benchmark and
are not used to claim a speedup. Source-level GPU disabling is established
separately in the evidence ledger.

## Provisional budgets and unmeasured items

For the tested **single-session** automated LAN scenario, initial regression
guards are: interactive interface within 3 seconds, first usable frame within
8 seconds, unchanged 1920×1080 stream resolution, continuing frame/audio
counters while unfocused, and total working-set sum below 1 GiB. These add
headroom to measured initial results; they are not an SLA for other firmware,
networks, workloads, or session counts.

The following require additional measurements rather than invented targets:

- One/two/three **distinct physical devices**, with equivalent moving content.
- Idle CPU/RAM, incremental per-device cost and repeated close/reopen plateaus.
- Calibrated OS CPU, GPU/media-engine utilization and decoder behavior by codec.
- Input-to-photon delay, first-frame distributions, long-run presentation drops
  and playback queues under interactive load.
- Tailscale-only candidate reachability/recovery; this device's Tailscale is off.
- A sustained conference call: intelligibility, echo, conversational delay,
  audio/video synchronization, device changes, and focus/resize while actively
  controlling the other two KVMs.
