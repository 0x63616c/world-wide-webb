import PanelKit
import SwiftUI
import UIKit
import CoreImage
import XCTest
@testable import Panel

@MainActor final class HybridModuleTests: XCTestCase {
    func testWifiOptInFallbackAndRecovery() async throws {
        XCTAssertFalse(ModuleFlags.shippedNative.contains(.wifi))
        XCTAssertEqual(ModuleFlags(nativeByDefault: ModuleFlags.shippedNative)[.wifi], .web)
        let (store, transport) = try fixtureStore()
        let router = HybridRouter(flags: ModuleFlags(overrides: ["moduleFlag.wifi": "native"]))
        func route() -> HybridRouter.Route { router.route(for: .wifi, hasLiveData: store.hasLiveData(for: .wifi)) }
        await store.run(modules: [])
        let initialRequests = await transport.requests
        XCTAssertTrue(initialRequests.isEmpty)
        XCTAssertEqual(route(), .webBoard)
        await store.refresh(.wifi)
        XCTAssertEqual(route(), .native(.wifi))
        XCTAssertEqual(store.wifi.ssid, "Example Guest")
        XCTAssertNotNil(store.wifi.password)
        let payload = try XCTUnwrap(store.wifiProvider.qrPayload)
        XCTAssertTrue(payload.contains("H:true;"), "Preserve server fields beyond display credentials.")
        try assertDecodes(payload)
        for file in ["wifi/unconfigured.json", "wifi/malformed.json", "wifi/missing.json"] {
            await transport.setFixture(file, for: "wifi.guestQr")
            await store.refresh(.wifi)
            XCTAssertEqual(route(), .webBoard)
            XCTAssertNil(store.wifiProvider.qrPayload)
            XCTAssertNil(store.wifi.password)
            XCTAssertNil(store.wifi.ssid)
        }
        await transport.setFixture("wifi/open.json", for: "wifi.guestQr")
        await store.refresh(.wifi)
        XCTAssertEqual(route(), .native(.wifi))
        XCTAssertNil(store.wifi.password)
        try assertDecodes(XCTUnwrap(store.wifiProvider.qrPayload))
        XCTAssertEqual(HybridRouter(flags: ModuleFlags()).route(for: .wifi, hasLiveData: true), .webBoard)
        store.stop()
        XCTAssertEqual(route(), .webBoard)
    }

    func testBrightnessScopeRestoresExactlyOnceAndCanBeReused() {
        let lease = WifiBrightnessLease()
        var level: CGFloat = 0.37
        var writes: [CGFloat] = []
        let write: (CGFloat) -> Void = { level = $0; writes.append($0) }
        lease.acquire(read: { level }, write: write)
        XCTAssertEqual(level, 1)
        lease.acquire(read: { level }, write: write)
        lease.restore() // tap, timeout, background, loss of data and dismantle share this seam
        lease.restore()
        XCTAssertEqual(level, 0.37)
        XCTAssertEqual(writes, [1, 0.37])
        level = 0.62
        lease.acquire(read: { level }, write: write)
        lease.restore()
        XCTAssertEqual(level, 0.62)
        XCTAssertEqual(WifiQRFullScreen.timeout, .seconds(60))
    }

    func testWifiSurfacesRenderAtPanelSize() async throws {
        let (store, _) = try fixtureStore()
        await store.refresh(.wifi)
        let scene = try XCTUnwrap(UIApplication.shared.connectedScenes.first as? UIWindowScene)
        let canvas = CGSize(width: 1366, height: 1024)
        let window = UIWindow(windowScene: scene)
        window.frame = CGRect(origin: .zero, size: canvas)
        window.windowLevel = .alert + 1
        let originalBrightness = scene.screen.brightness
        defer { window.isHidden = true; window.rootViewController = nil }
        let output = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("WifiVerification")
        try FileManager.default.createDirectory(at: output, withIntermediateDirectories: true)
        for detail in [false, true] {
            let view: AnyView = detail
                ? AnyView(WifiQRFullScreen(payload: try XCTUnwrap(store.wifiProvider.qrPayload),
                                          ssid: try XCTUnwrap(store.wifi.ssid), close: {}))
                : AnyView(HybridNativeModule(module: .wifi, store: store, detail: false, open: {}))
            let host = UIHostingController(rootView: view.frame(width: canvas.width, height: canvas.height)
                .environment(\.horizontalSizeClass, .regular).ignoresSafeArea())
            host.safeAreaRegions = []
            window.rootViewController = host
            window.makeKeyAndVisible()
            host.view.frame = window.bounds
            host.view.layoutIfNeeded()
            try await Task.sleep(for: .milliseconds(700))
            let format = UIGraphicsImageRendererFormat()
            format.scale = 1; format.opaque = true
            var rendered = false
            let image = UIGraphicsImageRenderer(size: canvas, format: format).image { _ in
                rendered = host.view.drawHierarchy(in: window.bounds, afterScreenUpdates: true)
            }
            XCTAssertTrue(rendered)
            XCTAssertEqual(image.cgImage?.width, 1366)
            XCTAssertEqual(image.cgImage?.height, 1024)
            let name = detail ? "wifi-fullscreen-qr" : "wifi-tile"
            try XCTUnwrap(image.pngData()).write(to: output.appendingPathComponent("\(name).png"))
            let attachment = XCTAttachment(image: image)
            attachment.name = name; attachment.lifetime = .keepAlways
            add(attachment)
            if detail {
                try assertDecodes(XCTUnwrap(store.wifiProvider.qrPayload), image: XCTUnwrap(image.cgImage))
                #if !targetEnvironment(simulator)
                XCTAssertEqual(scene.screen.brightness, 1, accuracy: 0.01)
                #endif // Simulator UIScreen always reports 0.5; the injected lease verifies writes.
            }
        }
        window.rootViewController = nil
        try await Task.sleep(for: .milliseconds(100))
        XCTAssertEqual(scene.screen.brightness, originalBrightness, accuracy: 0.01)
    }

    private func assertDecodes(_ payload: String, image: CGImage? = nil) throws {
        let code = try XCTUnwrap(image ?? GuestWifiCode.render(payload: payload))
        let source = CIImage(cgImage: code)
        let readable = image == nil ? source.transformed(by: CGAffineTransform(scaleX: 10, y: 10)) : source
        let detector = try XCTUnwrap(CIDetector(ofType: CIDetectorTypeQRCode, context: CIContext(),
            options: [CIDetectorAccuracy: CIDetectorAccuracyHigh]))
        let decoded = (detector.features(in: readable).first as? CIQRCodeFeature)?.messageString
        // Avoid including join credentials in XCTest diagnostics.
        XCTAssertTrue(decoded == payload, "QR must encode the exact server payload.")
    }

    private func fixtureStore() throws -> (LiveHomeDataSource, HybridFixtureTransport) {
        let root = try XCTUnwrap(Bundle(for: LiveHomeDataSource.self).resourceURL).appendingPathComponent("Fixtures")
        let transport = HybridFixtureTransport(root: root)
        let store = LiveHomeDataSource(configuration: PanelKit.PanelConfiguration(
            baseURL: URL(string: "https://fixture.example.invalid")!), transport: transport)
        return (store, transport)
    }
}
