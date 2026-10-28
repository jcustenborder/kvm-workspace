import AppKit
import CryptoKit
import Security
import WebKit

func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data("[WebKitProbe] \(message)\n".utf8))
    exit(64)
}

@MainActor
final class Probe: NSObject, NSApplicationDelegate, NSWindowDelegate, WKNavigationDelegate, WKUIDelegate {
    private let target: URL
    private let certificatePin: String?
    private let allowCapture: Bool
    private var password: String?
    private var window: NSWindow?
    private var webView: WKWebView?
    private var loginInFlight = false
    private var loginTimer: Timer?
    private var stopped = false

    init(target: URL, certificatePin: String?, password: String?, allowCapture: Bool = false) {
        self.target = target
        self.certificatePin = certificatePin
        self.password = password
        self.allowCapture = allowCapture
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        configuration.mediaTypesRequiringUserActionForPlayback = []
        configuration.userContentController.addUserScript(WKUserScript(source: #"""
        (() => {
            if (window.__kvmProbeVideoFrames) return;
            const counters = new WeakMap();
            window.__kvmProbeVideoFrames = counters;
            const instrument = () => {
                for (const video of document.querySelectorAll('video')) {
                    if (counters.has(video)) continue;
                    const available = typeof video.requestVideoFrameCallback === 'function';
                    const counter = {availability: available ? 'available' : 'unavailable',
                        count: available ? 0 : null, mediaTime: null};
                    counters.set(video, counter);
                    if (!available) continue;
                    const frame = (_now, metadata) => {
                        counter.count++;
                        counter.mediaTime = Number.isFinite(metadata.mediaTime) ? metadata.mediaTime : null;
                        video.requestVideoFrameCallback(frame);
                    };
                    video.requestVideoFrameCallback(frame);
                }
            };
            instrument();
            new MutationObserver(instrument).observe(document, {childList: true, subtree: true});
        })()
        """#, injectionTime: .atDocumentEnd, forMainFrameOnly: true))
        let frame = NSRect(x: 0, y: 0, width: 1100, height: 760)
        let view = WKWebView(frame: frame, configuration: configuration)
        view.navigationDelegate = self
        view.uiDelegate = self
        let window = NSWindow(contentRect: frame,
                              styleMask: [.titled, .closable, .miniaturizable, .resizable],
                              backing: .buffered, defer: false)
        window.title = "Disposable WebKit Probe"
        window.tabbingMode = .disallowed
        window.isReleasedWhenClosed = false
        window.delegate = self
        window.contentView = view
        window.center()
        self.window = window
        webView = view
        window.makeKeyAndOrderFront(nil)
        NSApp.activate()
        print("[WebKitProbe] started; certificate mode=\(certificatePin == nil ? "system" : "pinned")")
        print("[WebKitProbe] capture mode=\(allowCapture ? "target-main-frame opt-in" : "denied")")
        view.load(URLRequest(url: target))
        for seconds: Int in [10, 25] {
            DispatchQueue.main.asyncAfter(deadline: .now() + Double(seconds)) { [weak self] in
                self?.sample(seconds: seconds)
            }
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 35) { [weak self] in
            self?.quit()
        }
    }

    private func isTarget(_ url: URL?) -> Bool {
        guard let url: URL = url else { return false }
        return url.scheme?.lowercased() == target.scheme?.lowercased()
            && url.host?.lowercased() == target.host?.lowercased()
            && (url.port ?? 443) == (target.port ?? 443)
            && url.user == nil && url.password == nil
    }

    private func isTarget(_ origin: WKSecurityOrigin) -> Bool {
        return origin.protocol.lowercased() == target.scheme?.lowercased()
            && origin.host.lowercased() == target.host?.lowercased()
            && (origin.port == 0 ? 443 : origin.port) == (target.port ?? 443)
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        let allowed = !stopped && isTarget(navigationAction.request.url)
            && navigationAction.targetFrame != nil && !navigationAction.shouldPerformDownload
        if !allowed { print("[WebKitProbe] navigation blocked") }
        decisionHandler(allowed ? .allow : .cancel)
    }

    func webView(_ webView: WKWebView, didReceive challenge: URLAuthenticationChallenge,
                 completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {
        guard !stopped,
              challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust,
              challenge.protectionSpace.host.lowercased() == target.host?.lowercased(),
              challenge.protectionSpace.port == (target.port ?? 443) else {
            completionHandler(.cancelAuthenticationChallenge, nil)
            return
        }
        guard let pin: String = certificatePin else {
            completionHandler(.performDefaultHandling, nil)
            return
        }
        guard let trust: SecTrust = challenge.protectionSpace.serverTrust,
              let chain: [SecCertificate] = SecTrustCopyCertificateChain(trust) as? [SecCertificate],
              let leaf: SecCertificate = chain.first else {
            print("[WebKitProbe] TLS leaf unavailable; rejected")
            completionHandler(.cancelAuthenticationChallenge, nil)
            return
        }
        let digest = SHA256.hash(data: SecCertificateCopyData(leaf) as Data)
            .map { (byte: UInt8) -> String in String(format: "%02x", byte) }.joined()
        guard digest == pin else {
            print("[WebKitProbe] TLS leaf pin mismatch; rejected")
            completionHandler(.cancelAuthenticationChallenge, nil)
            return
        }
        print("[WebKitProbe] TLS leaf pin matched")
        completionHandler(.useCredential, URLCredential(trust: trust))
    }

    func webView(_ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin,
                 initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType,
                 decisionHandler: @escaping (WKPermissionDecision) -> Void) {
        let allowed = allowCapture && !stopped && webView === self.webView
            && frame.webView === webView && frame.isMainFrame
            && isTarget(webView.url) && isTarget(frame.request.url)
            && isTarget(origin) && isTarget(frame.securityOrigin)
        print("[WebKitProbe] camera/microphone capture \(allowed ? "granted for target main frame" : "denied")")
        decisionHandler(allowed ? .grant : .deny)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        guard !stopped, isTarget(webView.url) else { return }
        print("[WebKitProbe] page finished")
        if loginTimer == nil, password?.isEmpty == false {
            let timer = Timer(timeInterval: 0.5, target: self, selector: #selector(tryLogin), userInfo: nil, repeats: true)
            loginTimer = timer
            RunLoop.main.add(timer, forMode: .common)
            print("[WebKitProbe] polling for visible login controls until submission or shutdown")
        }
        tryLogin()
    }

    @objc private func tryLogin() {
        guard !stopped, !loginInFlight,
              let webView: WKWebView = webView, isTarget(webView.url),
              let password: String = password, !password.isEmpty else { return }
        loginInFlight = true
        // Only the real, visible login controls are touched; no transport or HID is synthesized.
        let script = #"""
        const visible = (element) => element.getClientRects().length > 0
            && getComputedStyle(element).visibility === 'visible';
        const inputs = [...document.querySelectorAll('input[type="password"]')].filter(visible);
        if (inputs.length !== 1) return 'not-login';
        const input = inputs[0];
        // Firmware loginPage-3lEqg6rA.js: this control is a sibling of the inner form.
        const loginButtons = () => [...document.querySelectorAll('.login-form .operation-btn.full-width')]
            .filter((button) => visible(button)
                && /^log\s*in$/i.test((button.innerText || button.value || '').trim())
                && button.closest('.login-form').contains(input));
        if (loginButtons().length !== 1 || input.disabled || input.readOnly) return 'not-login';
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        setter.call(input, password);
        input.dispatchEvent(new Event('input', {bubbles: true}));
        input.dispatchEvent(new Event('change', {bubbles: true}));
        await new Promise((resolve) => setTimeout(resolve, 0));
        const buttons = loginButtons();
        if (buttons.length !== 1 || buttons[0].disabled
            || buttons[0].getAttribute('aria-disabled') === 'true') return 'not-login';
        buttons[0].click();
        return 'submitted';
        """#
        webView.callAsyncJavaScript(script, arguments: ["password": password], in: nil, in: .page) {
            [weak self] (result: Result<Any, Error>) in
            guard let self: Probe = self, !self.stopped else { return }
            self.loginInFlight = false
            switch result {
            case .success(let value):
                if let status: String = value as? String, status == "submitted" {
                    self.password = nil
                    self.loginTimer?.invalidate()
                    self.loginTimer = nil
                    print("[WebKitProbe] login submitted once")
                } else if value as? String != "not-login" {
                    print("[WebKitProbe] unexpected login result; polling continues")
                }
            case .failure:
                // Do not print JavaScript exceptions: they may contain credential data.
                print("[WebKitProbe] login evaluation failed; polling continues")
            }
        }
    }

    private func sample(seconds: Int) {
        guard !stopped else { return }
        guard let view: WKWebView = webView, isTarget(view.url) else {
            print("[WebKitProbe] status at \(seconds)s: no target document")
            return
        }
        // Report only fixed labels, booleans and media counters, never URL/title/body/credentials.
        let script = #"""
        (() => {
            const visible = (element) => element.getClientRects().length > 0
                && getComputedStyle(element).visibility === 'visible';
            return JSON.stringify({
                documentReady: ['loading', 'interactive', 'complete'].includes(document.readyState)
                    ? document.readyState : 'unknown',
                loginVisible: [...document.querySelectorAll('input[type="password"]')].some(visible),
                secureContext: Boolean(window.isSecureContext),
                peerConnectionAPI: typeof window.RTCPeerConnection === 'function',
                microphoneAPI: typeof navigator.mediaDevices?.getUserMedia === 'function',
                videos: [...document.querySelectorAll('video')].map((video) => {
                    const style = getComputedStyle(video);
                    const rect = video.getBoundingClientRect();
                    const top = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
                    return {
                        readyState: Number(video.readyState),
                        width: Number(video.videoWidth), height: Number(video.videoHeight),
                        decodedFrames: Number.isFinite(video.webkitDecodedFrameCount)
                            ? Number(video.webkitDecodedFrameCount) : null,
                        totalVideoFrames: video.getVideoPlaybackQuality?.().totalVideoFrames ?? null,
                        videoFrameCallback: window.__kvmProbeVideoFrames?.get(video) ?? {
                            availability: typeof video.requestVideoFrameCallback === 'function'
                                ? 'not-instrumented' : 'unavailable', count: null, mediaTime: null
                        },
                        paused: Boolean(video.paused), hidden: !visible(video),
                        masked: Boolean(video.closest('[class*="masked"]'))
                            || Boolean(style.maskImage && style.maskImage !== 'none'),
                        coveredAtCenter: Boolean(top && top !== video && !video.contains(top))
                    };
                })
            });
        })()
        """#
        view.evaluateJavaScript(script) { [weak self] (value: Any?, error: Error?) in
            guard let self: Probe = self, !self.stopped else { return }
            if error != nil {
                print("[WebKitProbe] status at \(seconds)s: evaluation failed")
            } else if let status: String = value as? String {
                print("[WebKitProbe] status at \(seconds)s: \(status)")
            }
        }
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        print("[WebKitProbe] provisional navigation failed code=\((error as NSError).code)")
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        print("[WebKitProbe] navigation failed code=\((error as NSError).code)")
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        print("[WebKitProbe] web content process terminated")
        quit()
    }

    private func stop() {
        guard !stopped else { return }
        stopped = true
        loginTimer?.invalidate()
        loginTimer = nil
        loginInFlight = false
        password = nil
        webView?.stopLoading()
        webView?.setCameraCaptureState(.none, completionHandler: nil)
        webView?.setMicrophoneCaptureState(.none, completionHandler: nil)
        webView?.pauseAllMediaPlayback(completionHandler: nil)
        webView?.navigationDelegate = nil
        webView?.uiDelegate = nil
        webView?.removeFromSuperview()
        webView = nil
        window?.orderOut(nil)
        print("[WebKitProbe] stopped navigation/capture; quitting")
    }

    private func quit() {
        stop()
        NSApp.terminate(nil)
    }

    func windowWillClose(_ notification: Notification) { quit() }
    func applicationWillTerminate(_ notification: Notification) { stop() }
}

let environment = ProcessInfo.processInfo.environment
guard let rawURL: String = environment["KVM_PROBE_URL"], !rawURL.isEmpty else {
    fail("KVM_PROBE_URL is required; no default target")
}
guard let target: URL = URL(string: rawURL), target.scheme?.lowercased() == "https",
      let host: String = target.host, !host.isEmpty,
      target.user == nil, target.password == nil else {
    fail("KVM_PROBE_URL must be an absolute HTTPS URL without embedded credentials")
}
var certificatePin: String?
if let rawPin: String = environment["KVM_PROBE_CERT_SHA256"] {
    let pin = rawPin.replacingOccurrences(of: ":", with: "").lowercased()
    guard pin.range(of: "^[0-9a-f]{64}$", options: .regularExpression) != nil else {
        fail("KVM_PROBE_CERT_SHA256 must be a SHA-256 hex digest (colons optional)")
    }
    certificatePin = pin
}
MainActor.assumeIsolated {
    let application = NSApplication.shared
    let probe = Probe(target: target, certificatePin: certificatePin, password: environment["KVM_PASSWORD"],
                      allowCapture: environment["KVM_PROBE_ALLOW_CAPTURE"] == "1")
    application.setActivationPolicy(.regular)
    application.delegate = probe
    withExtendedLifetime(probe) { application.run() }
}
