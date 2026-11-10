import SwiftUI
import UIKit
import XCTest

/// Own the pixels synchronously instead of waiting for an asynchronous image provider.
@MainActor enum TestBitmap {
    static func render(_ view: some View, size: CGSize) throws -> CGImage {
        let renderer = ImageRenderer(content: view.frame(width: size.width, height: size.height))
        renderer.scale = 1
        let context = try XCTUnwrap(
            CGContext(
                data: nil, width: Int(size.width), height: Int(size.height),
                bitsPerComponent: 8, bytesPerRow: Int(size.width) * 4, space: CGColorSpaceCreateDeviceRGB(),
                bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue))
        renderer.render { _, draw in draw(context) }
        return try XCTUnwrap(context.makeImage())
    }
}
