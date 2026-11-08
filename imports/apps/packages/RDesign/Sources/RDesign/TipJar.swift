#if canImport(SwiftUI)
import StoreKit
import SwiftUI

/// Optional tips: consumables that unlock nothing. Each app supplies its own product IDs. Show the
/// Settings row only when `phase == .ready`, so a missing or misconfigured store simply hides it.
@MainActor @Observable public final class RTipJar {
    public struct Tip: Identifiable, Hashable, Sendable {
        /// A short stable key; UI tests find each button as "tip-<id>".
        public let id: String
        public let productID: String
        public let fallbackName: String
        public let symbol: String
        public init(id: String, productID: String, fallbackName: String, symbol: String) {
            self.id = id; self.productID = productID; self.fallbackName = fallbackName; self.symbol = symbol
        }
    }
    public enum Phase: Sendable { case loading, ready, unavailable }

    public let tips: [Tip]
    public private(set) var phase = Phase.loading
    public private(set) var products: [Tip: Product] = [:]
    public private(set) var purchasing: Tip?
    /// A calm, one-line status for pending or failed purchases. Cancelling says nothing.
    public var notice: String?
    /// Set when a purchase completes; the sheet closes and the app shows `RTipThanks`.
    public var completed: Tip?
    /// UI tests only: finish purchases with this outcome instead of asking the App Store. The
    /// simulator's StoreKit daemon can ignore SKTestSession and demand an Apple Account sign-in.
    public enum SimulatedOutcome: String, Sendable { case success, failure, pending }
    public var simulatedOutcome: SimulatedOutcome?
    private var updates: Task<Void, Never>?

    public init(tips: [Tip]) { self.tips = tips }

    public func load() async {
        listenForUpdates()
        guard phase != .ready else { return }
        phase = .loading
        do {
            let loaded = try await Product.products(for: tips.map(\.productID))
            products = Dictionary(uniqueKeysWithValues: loaded.compactMap { product in
                tips.first { $0.productID == product.id }.map { ($0, product) }
            })
            phase = products.count == tips.count ? .ready : .unavailable
        } catch {
            phase = .unavailable
        }
    }

    public func buy(_ tip: Tip) async {
        guard let product = products[tip], purchasing == nil else { return }
        purchasing = tip
        notice = nil
        defer { purchasing = nil }
        if let outcome = simulatedOutcome {
            try? await Task.sleep(for: .milliseconds(300))
            switch outcome {
            case .success: completed = tip
            case .failure: notice = "That tip didn't go through. Please try again later."
            case .pending: notice = "Your tip is waiting for approval. Thank you for the thought."
            }
            return
        }
        do {
            switch try await product.purchase() {
            case .success(.verified(let transaction)):
                await transaction.finish()
                completed = tip
            case .success(.unverified(let transaction, _)):
                await transaction.finish()
                notice = "The App Store couldn't verify that tip. If you were charged, Apple can refund it from your purchase history."
            case .pending:
                notice = "Your tip is waiting for approval. Thank you for the thought."
            case .userCancelled:
                break
            @unknown default:
                break
            }
        } catch {
            notice = "That tip didn't go through. Please try again later."
        }
    }

    /// Ask to Buy approvals and interrupted purchases arrive later. Finish them quietly: no pop-ups.
    private func listenForUpdates() {
        guard updates == nil else { return }
        updates = Task {
            for await result in Transaction.updates {
                if case .verified(let transaction) = result { await transaction.finish() }
            }
        }
    }
}

/// The Settings row that opens the tip sheet. Its accessibility identifier is "support<AppName>".
public struct RSupportRow: View {
    let appName: String
    let action: () -> Void
    public init(appName: String, action: @escaping () -> Void) { self.appName = appName; self.action = action }
    public var body: some View {
        Button(action: action) { Label("Support \(appName)", systemImage: "heart") }
            .accessibilityIdentifier("support\(appName)")
    }
}

public struct RTipJarSheet: View {
    @Environment(\.dismiss) private var dismiss
    let jar: RTipJar
    let title: String
    let prompt: String
    public init(jar: RTipJar, title: String, prompt: String) { self.jar = jar; self.title = title; self.prompt = prompt }
    public var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 22) {
                    RMark().padding(.top, RSpacing.xs)
                    VStack(spacing: RSpacing.xs) {
                        Text(title).font(.title.bold())
                        Text(prompt).foregroundStyle(.secondary)
                    }
                    VStack(spacing: RSpacing.s) {
                        ForEach(jar.tips) { tip in row(tip) }
                    }
                    if let notice = jar.notice {
                        Text(notice).font(.footnote).foregroundStyle(.secondary).multilineTextAlignment(.center)
                            .accessibilityIdentifier("tipNotice")
                    }
                }.padding(RSpacing.l)
            }
            .background(RPalette.background)
            .navigationTitle("")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() }.disabled(jar.purchasing != nil) } }
        }
        .interactiveDismissDisabled(jar.purchasing != nil)
        .onChange(of: jar.completed) { _, tip in if tip != nil { dismiss() } }
        .onAppear { jar.notice = nil }
    }

    private func row(_ tip: RTipJar.Tip) -> some View {
        let product = jar.products[tip]
        return HStack(spacing: 14) {
            Image(systemName: tip.symbol).font(.title3).foregroundStyle(.tint)
                .frame(width: 44, height: 44).background(.tint.opacity(0.10), in: RoundedRectangle(cornerRadius: 13, style: .continuous))
            Text(product?.displayName ?? tip.fallbackName).font(.headline)
            Spacer(minLength: RSpacing.xs)
            Button { Task { await jar.buy(tip) } } label: {
                ZStack {
                    Text(product?.displayPrice ?? "").opacity(jar.purchasing == tip ? 0 : 1)
                    if jar.purchasing == tip { ProgressView().controlSize(.small).tint(RPalette.background) }
                }.font(.subheadline.weight(.semibold)).foregroundStyle(RPalette.background).frame(minWidth: 64)
            }
            .buttonStyle(.borderedProminent).buttonBorderShape(.capsule)
            .disabled(product == nil || jar.purchasing != nil)
            .accessibilityLabel("\(product?.displayName ?? tip.fallbackName), \(product?.displayPrice ?? "")")
            .accessibilityIdentifier("tip-\(tip.id)")
        }.card()
    }
}

/// Full-screen thank-you after a completed tip, with the confetti cannon behind it.
public struct RTipThanks: View {
    @Environment(\.dismiss) private var dismiss
    let tip: RTipJar.Tip
    public init(tip: RTipJar.Tip) { self.tip = tip }
    public var body: some View {
        ZStack {
            RPalette.background.ignoresSafeArea()
            ScrollView {
                VStack(spacing: 18) {
                    RMark(size: 88)
                    Text("Thank you").font(.largeTitle.bold()).accessibilityIdentifier("tipThanks")
                    Button { dismiss() } label: { Text("Close").font(.headline).foregroundStyle(RPalette.background).frame(maxWidth: 240).padding(.vertical, 6) }
                        .buttonStyle(.borderedProminent).buttonBorderShape(.capsule).padding(.top, RSpacing.xs)
                }.padding(RSpacing.xxl).frame(maxWidth: .infinity)
            }.defaultScrollAnchor(.center)
            RConfettiCannon().ignoresSafeArea().allowsHitTesting(false)
        }
    }
}

/// Two cannons in the bottom corners fire a single burst of monochrome paper that drifts down and
/// fades. Reduce Motion turns it off.
public struct RConfettiCannon: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.colorScheme) private var scheme
    @State private var start = Date()
    private let pieces = ConfettiPiece.burst(count: 170)
    private let duration = 4.6
    public init() {}
    public var body: some View {
        if !reduceMotion {
            TimelineView(.animation(paused: Date().timeIntervalSince(start) > duration)) { timeline in
                Canvas { context, size in
                    let time = timeline.date.timeIntervalSince(start)
                    let shades: [Color] = scheme == .dark
                        ? [.white, Color(white: 0.82), Color(white: 0.62), Color(white: 0.44)]
                        : [Color(white: 0.06), Color(white: 0.28), Color(white: 0.46), Color(white: 0.66)]
                    for piece in pieces { piece.draw(in: context, size: size, time: time, shades: shades) }
                }
            }
            .accessibilityHidden(true)
        }
    }
}

struct ConfettiPiece {
    enum Shape { case rectangle, circle, ribbon }
    let fromLeft: Bool
    let angle: Double
    let speed: Double
    let delay: Double
    let spin: Double
    let flutter: Double
    let shade: Int
    let shape: Shape

    func draw(in context: GraphicsContext, size: CGSize, time: Double, shades: [Color]) {
        let t = time - delay
        guard t > 0 else { return }
        let drag = 1.25
        let travel = (1 - exp(-drag * t)) / drag
        let x = (fromLeft ? 0 : size.width) + (fromLeft ? 1 : -1) * cos(angle) * speed * travel
        let y = size.height + 10 - sin(angle) * speed * travel + 260 * t * t
        let opacity = max(0, min(1, (4.4 - t) / 0.9))
        guard opacity > 0, y < size.height + 40 else { return }
        var layer = context
        layer.opacity = opacity
        layer.translateBy(x: x, y: y)
        layer.rotate(by: .radians(spin * t))
        layer.scaleBy(x: cos(flutter * t), y: 1)
        let path: Path = switch shape {
        case .rectangle: Path(CGRect(x: -4, y: -7, width: 8, height: 14))
        case .circle: Path(ellipseIn: CGRect(x: -4, y: -4, width: 8, height: 8))
        case .ribbon: Path(roundedRect: CGRect(x: -2, y: -9, width: 4, height: 18), cornerRadius: 2)
        }
        layer.fill(path, with: .color(shades[shade % shades.count]))
    }

    /// Deterministic, so every celebration (and screenshot) looks the same.
    static func burst(count: Int) -> [ConfettiPiece] {
        var state: UInt64 = 0x7E4D_C0FF_EE00
        func random() -> Double {
            state &+= 0x9E37_79B9_7F4A_7C15
            var z = state
            z = (z ^ (z >> 30)) &* 0xBF58_476D_1CE4_E5B9
            z = (z ^ (z >> 27)) &* 0x94D0_49BB_1331_11EB
            return Double((z ^ (z >> 31)) >> 11) / Double(1 << 53)
        }
        return (0..<count).map { index in
            ConfettiPiece(
                fromLeft: index.isMultiple(of: 2),
                angle: (52 + random() * 28) * .pi / 180,
                speed: 1350 + random() * 900,
                delay: random() * 0.22,
                spin: (random() - 0.5) * 14,
                flutter: 3 + random() * 7,
                shade: Int(random() * 4),
                shape: [.rectangle, .rectangle, .circle, .ribbon][Int(random() * 4)]
            )
        }
    }
}

#endif
