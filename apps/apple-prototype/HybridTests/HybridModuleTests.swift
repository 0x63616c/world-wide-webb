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

    func testSonosDefaultFallbackPlaybackAndSeekRouting() async throws {
        XCTAssertFalse(ModuleFlags.shippedNative.contains(.sonos))
        let (store, transport) = try fixtureStore()
        defer { store.stop() }
        let router = HybridRouter(flags: ModuleFlags(overrides: ["moduleFlag.sonos": "native"]))
        func route() -> HybridRouter.Route { router.route(for: .sonos, hasLiveData: store.hasLiveData(for: .sonos)) }
        XCTAssertEqual(route(), .webBoard)
        await store.refresh(.sonos)
        XCTAssertEqual(route(), .native(.sonos))
        XCTAssertFalse(store.sonosProvider.supportsPlaybackPosition)
        await transport.setFixture("sonos/playback.json", for: "sound.soundSystem")
        await store.refresh(.sonos)
        XCTAssertTrue(store.sonosProvider.supportsPlaybackPosition)
        XCTAssertEqual(store.rooms[1].positionSeconds, 72.5)
        XCTAssertEqual(store.rooms[1].position(at: .distantFuture), 72.5, "Paused positions do not advance.")
        await transport.setFixture("sonos/void.json", for: "sound.sonosSeek")
        store.send(.seek("media_player.test_beta", 32))
        for _ in 0..<1000 {
            if store.sonosProvider.pending.isEmpty { break }
            try await Task.sleep(for: .milliseconds(2))
        }
        let requests = await transport.requests
        let seek = try XCTUnwrap(requests.first { $0.url?.lastPathComponent == "sound.sonosSeek" })
        let input = try JSONSerialization.jsonObject(with: XCTUnwrap(seek.httpBody)) as! [String: Any]
        XCTAssertEqual(input["room"] as? String, "media_player.test_alpha")
        XCTAssertEqual(input["positionSeconds"] as? Double, 32)
        for file in ["sonos/empty.json", "sonos/unavailable.json"] {
            await transport.setFixture(file, for: "sound.soundSystem")
            await store.refresh(.sonos)
            XCTAssertEqual(route(), .webBoard)
        }
        await transport.setFixture("sonos/playback.json", for: "sound.soundSystem")
        await store.refresh(.sonos)
        XCTAssertEqual(route(), .native(.sonos))
        for module in [PanelModule.tesla, .walk, .cameras, .wifi, .media] {
            XCTAssertEqual(HybridRouter(flags: ModuleFlags()).route(for: module, hasLiveData: true), .webBoard)
        }
    }

    func testSonosSurfacesRenderAtPanelSize() async throws {
        let (store, transport) = try fixtureStore()
        defer { store.stop() }
        await transport.setFixture("sonos/playback.json", for: "sound.soundSystem")
        await store.refresh(.sonos)
        let scene = try XCTUnwrap(UIApplication.shared.connectedScenes.first as? UIWindowScene)
        let canvas = CGSize(width: 1366, height: 1024)
        let window = UIWindow(windowScene: scene)
        window.frame = CGRect(origin: .zero, size: canvas)
        window.windowLevel = .alert + 1
        defer { window.isHidden = true; window.rootViewController = nil }
        let output = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("SonosVerification")
        try FileManager.default.createDirectory(at: output, withIntermediateDirectories: true)
        let views: [(String, AnyView)] = [
            ("tile", AnyView(HybridNativeModule(module: .sonos, store: store, detail: false, open: {}))),
            ("now-playing", AnyView(HybridNativeModule(module: .sonos, store: store, detail: true, open: {}))),
            ("rooms", AnyView(SonosRoomsModule(store: store, select: { _ in }, close: {})
                .foregroundStyle(.white).tint(.white).background(Color.black).environment(\.colorScheme, .dark))),
            ("now-playing-legacy", AnyView(HybridNativeModule(module: .sonos, store: store, detail: true, open: {})))
        ]
        for (name, view) in views {
            if name == "now-playing-legacy" {
                await transport.setFixture("sonos/rooms.json", for: "sound.soundSystem")
                await store.refresh(.sonos)
            }
            window.rootViewController = UIHostingController(rootView: view)
            window.makeKeyAndVisible()
            try await Task.sleep(for: .seconds(1))
            let format = UIGraphicsImageRendererFormat(); format.scale = 1
            let image = UIGraphicsImageRenderer(size: canvas, format: format).image { _ in
                window.drawHierarchy(in: CGRect(origin: .zero, size: canvas), afterScreenUpdates: true)
            }
            try XCTUnwrap(image.pngData()).write(to: output.appendingPathComponent("\(name).png"))
            let attachment = XCTAttachment(image: image)
            attachment.name = "sonos-\(name)"; attachment.lifetime = .keepAlways
            add(attachment)
        }
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
