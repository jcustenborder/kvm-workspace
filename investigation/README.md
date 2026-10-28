# GLKVM investigation

The installed reference app is inspected read-only. Findings distinguish shipped
code, public source/documentation, runtime observations, and unverified behavior.
Extracted proprietary application files, raw runtime captures, and local device
information are local investigation inputs, not distributable application code.

## Initial host observations

- Reference: `/Applications/GLKVM.app`, bundle `com.glinet.kvmdesk`, version 1.6.0.
- REA plist Evidence: `ev_97762b9709e74fd2d7227c080fddc7289e246d10c18d3045bd59795eecba7864`.
- Execution host: Apple M4 Max, 16 CPU cores, 128 GB, arm64; macOS 26.6.2
  (25G83), Swift 6.4. The operator subsequently confirmed M4 Max as the target.
- REA 6.8.0 is installed under `.rea/`; its bundled workflow instructions are
  being followed through the CLI because REA MCP tools are absent in this session.
- Existing Tailscale installation reports Running and MagicDNS enabled.
- Only one peer name clearly identified as KVM was observed in the tailnet
  inventory; it reported offline with an expired node key. This does not prove
  that the user's other KVMs are unavailable or absent behind subnet routing.
- A running GLKVM process uses Electron and stores its profile in
  `~/Library/Application Support/gl-kvm`.

The real device was subsequently identified as RM1PE / V1.10.1 release2.
Packaged Electron hardware-decoded video and two-way Opus transport have passed
LAN validation. Its Tailscale service reports disabled. The operator's actual
conference-call quality/routing and three physical-device workload remain
unverified. Current findings and measurements are in `docs/`.
