import SwiftUI
import UIKit
import XCTest

@testable import Panel

/// WWW-68: the clock follows Apple HomeView's green numeral face, so the four
/// cardinal numerals are huge and reach the screen edges (the hands are meant
/// to sweep over them, as in the reference). Measures the rendered glyph pixels.
@MainActor final class ClockFaceLayoutTests: XCTestCase {
    func testNumeralsReachTheScreenEdges() throws {
        for size in [
            CGSize(width: 1376, height: 1032), CGSize(width: 1366, height: 1024), CGSize(width: 402, height: 874),
        ] {
            let ink = try inkBounds(GreenClockDial(date: FixtureClock.now, numeralsOnly: true), size: size)
            let face = GreenClockDial.Layout(size: size).face
            XCTAssertLessThanOrEqual(ink.minY - face.minY, face.height * 0.10, "12 must reach the top at \(size)")
            XCTAssertLessThanOrEqual(face.maxY - ink.maxY, face.height * 0.06, "6 must reach the bottom at \(size)")
            XCTAssertLessThanOrEqual(ink.minX, size.width * 0.09, "9 must reach the left edge at \(size)")
            XCTAssertLessThanOrEqual(size.width - ink.maxX, size.width * 0.09, "3 must reach the right edge at \(size)")
        }
    }

    func testFaceIsTheHomeViewGreenWithNoComplications() throws {
        let store = MockHomeDataSource(latency: .zero, fixedNow: FixtureClock.now)
        let size = CGSize(width: 1376, height: 1032)
        let image = try render(PresenceClockFace(store: store).faceContent(at: FixtureClock.now), size: size)
        let pixels = try rgba(image)
        // A corner sample sits where the old complications were.
        for (x, y) in [(120, 120), (image.width - 120, 120), (image.width - 120, image.height - 200)] {
            let o = (y * image.width + x) * 4
            XCTAssertEqual(Int(pixels[o]), 63, accuracy: 3)
            XCTAssertEqual(Int(pixels[o + 1]), 148, accuracy: 3)
            XCTAssertEqual(Int(pixels[o + 2]), 93, accuracy: 3)
        }
    }

    private func inkBounds(_ view: some View, size: CGSize) throws -> CGRect {
        let cg = try render(view.background(.white), size: size)
        let pixels = try rgba(cg)
        var minX = Int.max
        var minY = Int.max
        var maxX = Int.min
        var maxY = Int.min
        for y in 0..<cg.height {
            for x in 0..<cg.width {
                let o = (y * cg.width + x) * 4
                guard pixels[o] < 128, pixels[o + 1] < 128, pixels[o + 2] < 128 else { continue }
                minX = min(minX, x)
                maxX = max(maxX, x)
                minY = min(minY, y)
                maxY = max(maxY, y)
            }
        }
        XCTAssertLessThan(minX, Int.max, "Must measure rendered numerals")
        return CGRect(x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1)
    }

    private func render(_ view: some View, size: CGSize) throws -> CGImage {
        let renderer = ImageRenderer(content: view.frame(width: size.width, height: size.height))
        let context = try XCTUnwrap(
            CGContext(
                data: nil, width: Int(size.width), height: Int(size.height),
                bitsPerComponent: 8, bytesPerRow: Int(size.width) * 4, space: CGColorSpaceCreateDeviceRGB(),
                bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue))
        // uiImage uses an asynchronous image provider that can time out during
        // cold simulator shader compilation. Draw the same content synchronously.
        renderer.render { _, draw in draw(context) }
        return try XCTUnwrap(context.makeImage())
    }

    private func rgba(_ cg: CGImage) throws -> [UInt8] {
        var pixels = [UInt8](repeating: 255, count: cg.width * cg.height * 4)
        let context = try XCTUnwrap(
            CGContext(
                data: &pixels, width: cg.width, height: cg.height,
                bitsPerComponent: 8, bytesPerRow: cg.width * 4, space: CGColorSpaceCreateDeviceRGB(),
                bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue))
        context.draw(cg, in: CGRect(x: 0, y: 0, width: cg.width, height: cg.height))
        return pixels
    }
}
