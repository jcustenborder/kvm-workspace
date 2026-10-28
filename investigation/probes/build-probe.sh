#!/bin/zsh
set -euo pipefail
umask 077

probe_dir="${0:A:h}"
investigation_dir="${probe_dir:h}"
source_file="$probe_dir/WebKitProbe.swift"
[[ -d "$probe_dir" && -d "$investigation_dir" && -f "$source_file" ]] || {
    print -u2 -- "Probe source/parent directory missing"
    exit 1
}
private_dir="$investigation_dir/private"
mkdir -p "$private_dir"
[[ -d "$private_dir" ]] || exit 1
app_dir="$private_dir/WebKitProbe.app"
mkdir -p "$app_dir/Contents/MacOS" "$private_dir/swift-module-cache"

sdk="$(xcrun --sdk macosx --show-sdk-path)"
[[ -d "$sdk" ]] || { print -u2 -- "macOS SDK missing"; exit 1; }
xcrun --sdk macosx swiftc -O -target arm64-apple-macos14.0 -sdk "$sdk" \
    -module-cache-path "$private_dir/swift-module-cache" \
    -framework AppKit -framework WebKit -framework CryptoKit \
    "$source_file" -o "$app_dir/Contents/MacOS/WebKitProbe"

/bin/cat > "$app_dir/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleExecutable</key><string>WebKitProbe</string>
    <key>CFBundleIdentifier</key><string>local.disposable.WebKitProbe</string>
    <key>CFBundleName</key><string>WebKitProbe</string>
    <key>CFBundlePackageType</key><string>APPL</string>
    <key>CFBundleVersion</key><string>1</string>
    <key>CFBundleShortVersionString</key><string>0.1</string>
    <key>LSMinimumSystemVersion</key><string>14.0</string>
    <key>NSHighResolutionCapable</key><true/>
    <key>NSCameraUsageDescription</key>
    <string>Optional camera capture for the selected KVM when capture probing is explicitly enabled.</string>
    <key>NSMicrophoneUsageDescription</key>
    <string>Optional microphone capture for the selected KVM when capture probing is explicitly enabled.</string>
    <key>NSLocalNetworkUsageDescription</key>
    <string>Connect to the explicitly selected KVM for a disposable WebKit feasibility check.</string>
    <key>NSAppTransportSecurity</key>
    <dict><key>NSAllowsLocalNetworking</key><true/></dict>
</dict>
</plist>
PLIST
/usr/bin/plutil -lint "$app_dir/Contents/Info.plist"
/usr/bin/codesign --force --sign - "$app_dir"
# Offline check: inherited runtime settings must never supply an implicit target.
startup_status=0
/usr/bin/env -u KVM_PROBE_URL -u KVM_PROBE_CERT_SHA256 -u KVM_PASSWORD -u KVM_PROBE_ALLOW_CAPTURE \
    "$app_dir/Contents/MacOS/WebKitProbe" > /dev/null 2>&1 || startup_status=$?
[[ "$startup_status" == 64 ]] || {
    print -u2 -- "No-target startup check failed (exit $startup_status)"
    exit 1
}
print -r -- "Built $app_dir"
