import CoreImage.CIFilterBuiltins
import SwiftUI
import UIKit

/// Hybrid-only presentation; the prototype's design views and mock defaults stay intact.
struct WifiModule: View {
    let provider: LiveWifiProvider
    @State private var passwordVisible = false
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        HStack(spacing: 80) {
            VStack(alignment: .leading, spacing: 24) {
                Image(systemName: "wifi").font(.system(size: 52)).foregroundStyle(.cyan)
                Text(provider.wifi.ssid ?? "Not configured").font(.system(size: 44, weight: .semibold))
                if let password = provider.wifi.password {
                    HStack(alignment: .top, spacing: 16) {
                        Button { passwordVisible.toggle() } label: {
                            Image(systemName: passwordVisible ? "eye.slash" : "eye")
                                .font(.title3).frame(width: 52, height: 52)
                        }.buttonStyle(.glass).buttonBorderShape(.circle)
                            .accessibilityLabel(passwordVisible ? "Hide password" : "Reveal password")
                            .accessibilityIdentifier("wifi-password")
                        Text(password).font(.title3.monospaced()).fixedSize(horizontal: false, vertical: true)
                            .frame(maxWidth: .infinity, minHeight: 52, alignment: .leading)
                            .opacity(passwordVisible ? 1 : 0)
                            .accessibilityHidden(!passwordVisible)
                            .allowsHitTesting(passwordVisible)
                    }
                } else if provider.wifi.ssid != nil { Text("No password required") }
            }.frame(maxWidth: .infinity, alignment: .leading)
            if let payload = provider.qrPayload, let image = GuestWifiCode.render(payload: payload) {
                VStack(spacing: 20) {
                    WifiQRHero(image: image).frame(width: 380, height: 380)
                        .accessibilityIdentifier("wifi-inline-qr")
                    Label("scan to connect", systemImage: "qrcode.viewfinder")
                        .font(.title3).foregroundStyle(.secondary)
                }
            }
        }.padding(64).frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(.black).foregroundStyle(.white)
            .onChange(of: provider.qrPayload) { _, _ in passwordVisible = false }
            .onChange(of: scenePhase) { _, phase in if phase != .active { passwordVisible = false } }
            .onDisappear { passwordVisible = false }
    }
}

enum GuestWifiCode {
    static func render(payload: String) -> CGImage? {
        guard !payload.isEmpty else { return nil }
        let filter = CIFilter.qrCodeGenerator()
        filter.message = Data(payload.utf8)
        filter.correctionLevel = "M"
        guard let output = filter.outputImage else { return nil }
        return CIContext().createCGImage(output, from: output.extent)
    }
}

struct WifiQRFullScreen: View {
    let ssid: String
    let close: () -> Void
    private let image: CGImage?
    @State private var brightness = WifiBrightnessLease()
    @Environment(\.scenePhase) private var scenePhase
    static let timeout: Duration = .seconds(60)

    init(payload: String, ssid: String, close: @escaping () -> Void) {
        self.ssid = ssid
        self.close = close
        image = GuestWifiCode.render(payload: payload)
    }

    var body: some View {
        Button(action: finish) {
            GeometryReader { proxy in
                VStack(spacing: 20) {
                    Text(ssid).font(.system(size: 36, weight: .medium))
                    if let image {
                        WifiQRHero(image: image)
                            .frame(width: max(0, min(proxy.size.width - 96, proxy.size.height - 180)))
                    } else {
                        Text("QR unavailable. Tap to return.")
                    }
                    Text("Scan to join · Tap anywhere to close").font(.system(size: 22))
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .contentShape(.rect)
            }
        }
        .buttonStyle(.plain)
        .foregroundStyle(.black)
        .background(.white)
        .preferredColorScheme(.light)
        .statusBarHidden()
        .persistentSystemOverlays(.hidden)
        .accessibilityLabel("Join \(ssid). Scan the QR code. Tap to close.")
        .accessibilityIdentifier("wifi-fullscreen-qr")
        .background { WifiScreenAttachment(lease: brightness).allowsHitTesting(false) }
        .task {
            do { try await Task.sleep(for: Self.timeout) } catch { return }
            finish()
        }
        .onChange(of: scenePhase) { _, phase in if phase != .active { finish() } }
        .onDisappear { brightness.restore() }
    }

    private func finish() { brightness.restore(); close() }
}

/// Idempotent scope: a second attachment cannot overwrite the original brightness.
@MainActor final class WifiBrightnessLease {
    private var restoreBrightness: (() -> Void)?

    func acquire(read: () -> CGFloat, write: @escaping (CGFloat) -> Void) {
        guard restoreBrightness == nil else { return }
        let original = read()
        restoreBrightness = { write(original) }
        write(1)
    }

    func restore() {
        let restore = restoreBrightness
        restoreBrightness = nil
        restore?()
    }
}

/// Resolves the actual containing display, including external-window installations.
private struct WifiScreenAttachment: UIViewRepresentable {
    let lease: WifiBrightnessLease
    func makeUIView(context: Context) -> Attachment { Attachment(lease: lease) }
    func updateUIView(_ uiView: Attachment, context: Context) {}
    static func dismantleUIView(_ uiView: Attachment, coordinator: ()) { uiView.lease.restore() }

    final class Attachment: UIView {
        let lease: WifiBrightnessLease
        init(lease: WifiBrightnessLease) { self.lease = lease; super.init(frame: .zero) }
        required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
        override func didMoveToWindow() {
            super.didMoveToWindow()
            guard let screen = window?.screen else { lease.restore(); return }
            lease.acquire(read: { screen.brightness }, write: { screen.brightness = $0 })
        }
    }
}
