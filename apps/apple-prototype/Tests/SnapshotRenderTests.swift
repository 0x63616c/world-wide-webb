import SwiftUI
import UIKit
import XCTest
@testable import WorldWideWebb

/// Run on the already-booted iPad host, with no UI automation or application tour.
@MainActor final class SnapshotRenderTests: XCTestCase {
    private let canvas = CGSize(width: 1376, height: 1032)

    func testRenderFaces() async throws {
        let output = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("Snapshots", isDirectory: true)
        try FileManager.default.createDirectory(at: output, withIntermediateDirectories: true)
        let store = MockHomeDataSource(latency: .zero, fixedNow: ISO8601DateFormatter().date(from: "2026-10-29T17:10:30Z")!)
        let scenes: [(String, AnyView)] = [
            ("home", AnyView(SnapshotFace(store: store, controls: false))),
            ("controls-face", AnyView(SnapshotFace(store: store, controls: true))),
            ("lamps", AnyView(ZStack {
                LampsBackdrop()
                ControllerHost(tile: .bedroom, store: store, close: {})
            })),
            ("clock-idle", AnyView(SnapshotClock(store: store, near: false))),
            ("clock-near", AnyView(SnapshotClock(store: store, near: true))),
            ("alarm", AnyView(AlarmRingView(store: store, close: {}, edit: {}))),
            ("nowplaying", AnyView(ZStack {
                NowPlayingView(store: store, close: {})
                VStack { Spacer(); FacePicker(selection: .constant(3)).padding(.bottom, 10) }
            }))
        ]
        let scene = try XCTUnwrap(UIApplication.shared.connectedScenes.first as? UIWindowScene)
        let window = UIWindow(windowScene: scene)
        window.frame = CGRect(origin: .zero, size: canvas)
        window.windowLevel = .alert + 1
        defer { window.isHidden = true; window.rootViewController = nil }

        for (name, view) in scenes {
            let content = view.frame(width: canvas.width, height: canvas.height)
                .environment(\.colorScheme, .dark)
                .foregroundStyle(.white).tint(.white)
                .ignoresSafeArea()
            // Keep this output to document ImageRenderer's platform-effect limitations.
            let renderer = ImageRenderer(content: content)
            renderer.proposedSize = ProposedViewSize(canvas)
            renderer.scale = 2
            let image = try XCTUnwrap(renderer.uiImage)
            try XCTUnwrap(image.pngData()).write(to: output.appendingPathComponent("\(name)-imagerenderer.png"))

            // Faithful fallback: render the same view in one persistent unit-test window.
            // drawHierarchy includes native glass/backdrop compositing, unlike ImageRenderer.
            let host = UIHostingController(rootView: content)
            host.safeAreaRegions = []
            host.view.backgroundColor = .clear
            window.rootViewController = host
            window.makeKeyAndVisible()
            host.view.frame = window.bounds
            host.view.setNeedsLayout()
            host.view.layoutIfNeeded()
            try await Task.sleep(for: .milliseconds(650))
            let format = UIGraphicsImageRendererFormat()
            format.scale = 2
            format.opaque = true
            var rendered = false
            let hosted = UIGraphicsImageRenderer(size: canvas, format: format).image { _ in
                rendered = host.view.drawHierarchy(in: window.bounds, afterScreenUpdates: true)
            }
            XCTAssertTrue(rendered, "Native hierarchy failed for \(name)")
            XCTAssertEqual(hosted.cgImage?.width, 2752)
            XCTAssertEqual(hosted.cgImage?.height, 2064)
            try XCTUnwrap(hosted.pngData()).write(to: output.appendingPathComponent("\(name).png"))
            if name == "home" {
                // Gives the capture script a bounded opportunity for the one-time sim check.
                try Data().write(to: output.appendingPathComponent("glass-check-ready"))
                try await Task.sleep(for: .seconds(4))
            }
        }
    }
}

private struct SnapshotFace: View {
    let store: any HomeDataSource
    let controls: Bool
    @Namespace private var zoom
    var body: some View {
        ZStack {
            Wallpaper()
            GlassEffectContainer(spacing: 12) {
                HomeFaceGrid(store: store, size: CGSize(width: 1376, height: 1032),
                             controls: controls, zoom: zoom, open: { _ in })
            }
            VStack {
                Spacer()
                FacePicker(selection: .constant(controls ? 1 : 0)).padding(.bottom, 10)
            }
        }
    }
}

private struct SnapshotClock: View {
    let store: any HomeDataSource
    let near: Bool
    var body: some View {
        ZStack {
            PresenceClockFace(store: store, near: .constant(near), open: { _ in })
            VStack { Spacer(); FacePicker(selection: .constant(2)).padding(.bottom, 10) }
        }
    }
}
