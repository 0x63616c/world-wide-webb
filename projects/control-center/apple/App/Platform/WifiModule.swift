import CoreImage.CIFilterBuiltins
import SwiftUI
import UIKit

/// Centered join card: the QR code flips over to show the network name and password.
struct WifiModule: View {
    let provider: LiveWifiProvider
    @State private var flipped = false
    @State private var passwordVisible = false
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.panelCanvasProfile) private var canvas
    @Environment(\.displayScale) private var displayScale
    private var compact: Bool { canvas == .compact }

    private var qrImage: CGImage? {
        provider.qrPayload.flatMap { GuestWifiCode.render(payload: $0) }
    }

    var body: some View {
        let qr = qrImage
        return GeometryReader { geometry in
            let side = min(geometry.size.width - 48, geometry.size.height * 0.62, compact ? 460 : 540)
            VStack(spacing: 28) {
                if let qr {
                    card(qr: qr, width: max(0, side * 0.78), height: max(0, side))
                    Label("scan to connect", systemImage: "qrcode.viewfinder")
                        .font(.title3).foregroundStyle(.secondary)
                        .opacity(flipped ? 0 : 1)
                        .animation(.easeInOut(duration: 0.2), value: flipped)
                        .accessibilityHidden(flipped)
                } else {
                    Image(systemName: "wifi").font(.system(size: 52)).foregroundStyle(.cyan)
                    Text(provider.wifi.ssid ?? "Not configured")
                        .font(.system(size: compact ? 32 : 44, weight: .semibold))
                    if provider.wifi.ssid != nil { Text("No password required").foregroundStyle(.secondary) }
                }
            }
            .padding(24)
            .frame(width: geometry.size.width, height: geometry.size.height)
        }
        .background(.black).foregroundStyle(.white)
        .onChange(of: provider.qrPayload) { _, _ in reset() }
        .onChange(of: scenePhase) { _, phase in if phase != .active { reset() } }
        .onDisappear { reset() }
    }

    private func card(qr: CGImage, width: CGFloat, height: CGFloat) -> some View {
        ZStack {
            front(qr: qr, width: width, height: height)
                .accessibilityIdentifier("wifi-inline-qr")
                .modifier(WifiFlipFace(angle: flipped ? 180 : 0))
            details
                .frame(width: width, height: height)
                .background(Color(white: 0.13), in: .rect(cornerRadius: 32))
                .modifier(WifiFlipFace(angle: flipped ? 0 : -180))
        }
        .frame(width: width, height: height)
        .contentShape(.rect(cornerRadius: 32))
        .onTapGesture { flip() }
        .accessibilityElement(children: flipped ? .contain : .ignore)
        .accessibilityLabel(flipped ? "" : "Guest Wi-Fi join QR code")
        .accessibilityHint(flipped ? "" : "Shows the network name and password")
        .accessibilityAddTraits(flipped ? [] : .isButton)
        .accessibilityAction { flip() }
        .accessibilityIdentifier("wifi-card")
    }

    /// White card with the code (whole physical pixels per module) above the network name.
    private func front(qr: CGImage, width: CGFloat, height: CGFloat) -> some View {
        let modules = CGFloat(qr.width)
        let pixelsPerModule = max(1, floor(width * 0.78 * displayScale / modules))
        let codeSide = modules * pixelsPerModule / displayScale
        // Equal white margin above and beside the code; the name sits centred below.
        let margin = (width - codeSide) / 2
        return VStack(spacing: 0) {
            Image(decorative: qr, scale: 1)
                .resizable().interpolation(.none)
                .frame(width: codeSide, height: codeSide)
                .padding(.top, margin)
            Spacer(minLength: 0)
            if let ssid = provider.wifi.ssid {
                Text(ssid).font(.system(size: compact ? 22 : 28, weight: .semibold))
                    .foregroundStyle(.black).lineLimit(1).minimumScaleFactor(0.5)
                    .padding(.horizontal, 24)
            }
            Spacer(minLength: 0)
        }
        .frame(width: width, height: height)
        .background(.white, in: .rect(cornerRadius: 32))
        .compositingGroup()
        .shadow(color: .black.opacity(0.18), radius: 28, y: 16)
    }

    private var details: some View {
        VStack(alignment: .leading, spacing: 28) {
            VStack(alignment: .leading, spacing: 6) {
                Text("SSID").font(.headline).foregroundStyle(.secondary)
                Text(provider.wifi.ssid ?? "Not configured")
                    .font(.system(size: compact ? 24 : 30, weight: .semibold))
                    .lineLimit(2).minimumScaleFactor(0.6)
            }
            VStack(alignment: .leading, spacing: 6) {
                Text("Password").font(.headline).foregroundStyle(.secondary)
                HStack(alignment: .center, spacing: 12) {
                    let password = provider.wifi.password ?? ""
                    ZStack(alignment: .leading) {
                        Text(password).opacity(passwordVisible ? 1 : 0)
                            .accessibilityHidden(!passwordVisible)
                        Text(String(repeating: "•", count: 10)).opacity(passwordVisible ? 0 : 1)
                            .accessibilityHidden(true)
                    }
                    .font(.system(size: compact ? 20 : 24, design: .monospaced))
                    .lineLimit(2).minimumScaleFactor(0.5)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    Button {
                        passwordVisible.toggle()
                    } label: {
                        Image(systemName: passwordVisible ? "eye.slash" : "eye")
                            .font(.title3).frame(height: 44)
                    }
                    .buttonStyle(.plain).foregroundStyle(.secondary).contentShape(.rect)
                    .accessibilityLabel(passwordVisible ? "Hide password" : "Reveal password")
                    .accessibilityIdentifier("wifi-password")
                }
            }
        }
        .padding(compact ? 24 : 36)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    private func flip() {
        withAnimation(reduceMotion ? .easeInOut(duration: 0.2) : .spring(duration: 0.55, bounce: 0.15)) {
            flipped.toggle()
        }
        if !flipped { passwordVisible = false }
    }

    private func reset() {
        flipped = false
        passwordVisible = false
    }
}

/// One side of a card flip: rotates on the vertical axis and hides once turned away.
private struct WifiFlipFace: ViewModifier, @MainActor Animatable {
    var angle: Double
    var animatableData: Double {
        get { angle }
        set { angle = newValue }
    }
    func body(content: Content) -> some View {
        content
            .rotation3DEffect(.degrees(angle), axis: (x: 0, y: 1, z: 0), perspective: 0.4)
            .opacity(abs(angle) < 90 ? 1 : 0)
            .allowsHitTesting(abs(angle) < 90)
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

    private func finish() {
        brightness.restore()
        close()
    }
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
        init(lease: WifiBrightnessLease) {
            self.lease = lease
            super.init(frame: .zero)
        }
        required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
        override func didMoveToWindow() {
            super.didMoveToWindow()
            guard let screen = window?.screen else {
                lease.restore()
                return
            }
            lease.acquire(read: { screen.brightness }, write: { screen.brightness = $0 })
        }
    }
}
