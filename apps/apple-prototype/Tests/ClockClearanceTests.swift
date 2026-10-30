import SwiftUI
import UIKit
import XCTest
@testable import WorldWideWebb

@MainActor final class ClockClearanceTests: XCTestCase {
    func testEveryHandAngleClearsActualSystemNumeralGlyphs() throws {
        // The union of every rotation is a disk. Measure the actual SF glyph
        // pixels, rather than relying on text frames or only the fixture angle.
        for side: CGFloat in [378, 722.4, 908.16] {
            let renderer = ImageRenderer(content:
                GreenClockDial(date: FixtureClock.now, showsHands: false)
                    .frame(width: side, height: side).background(.white))
            renderer.scale = 2
            let cg = try XCTUnwrap(renderer.uiImage?.cgImage)
            let width = cg.width, height = cg.height
            var pixels = [UInt8](repeating: 255, count: width * height * 4)
            let context = try XCTUnwrap(CGContext(data: &pixels, width: width, height: height,
                bitsPerComponent: 8, bytesPerRow: width * 4,
                space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue))
            context.draw(cg, in: CGRect(x: 0, y: 0, width: width, height: height))
            var nearest = CGFloat.infinity
            for y in 0..<height {
                for x in 0..<width {
                    let offset = (y * width + x) * 4
                    guard pixels[offset] < 128, pixels[offset + 1] < 128, pixels[offset + 2] < 128 else { continue }
                    nearest = min(nearest, hypot((CGFloat(x) + 0.5) / 2 - side / 2,
                                                (CGFloat(y) + 0.5) / 2 - side / 2))
                }
            }
            XCTAssertTrue(nearest.isFinite, "Must measure rendered numerals")
            XCTAssertGreaterThanOrEqual(nearest - side * GreenClockDial.maximumHandFraction, 24,
                "Every hand must clear every numeral by 24 pt at side \(side)")
        }
    }
}
