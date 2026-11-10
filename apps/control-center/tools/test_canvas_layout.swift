import CoreGraphics
import Foundation
import ImageIO

/// Exercise real layout proposals, including portrait and resized windows.
@main
enum CanvasLayoutCheck {
    static func checkRendering(_ path: String) -> Bool {
        guard let source = CGImageSourceCreateWithURL(URL(fileURLWithPath: path) as CFURL, nil),
            let image = CGImageSourceCreateImageAtIndex(source, 0, nil)
        else {
            print("FAIL: cannot read native display capture \(path)")
            return false
        }
        let w = image.width
        let h = image.height
        var filled = true
        // Native display captures avoid XCTest's ambiguous main screen on Duo.
        // Sample away from corners, the home indicator and the camera region.
        for (x, y) in [(1, h / 2), (w - 2, h / 2), (w / 2, 1), (w / 2, h - 2)] {
            guard let pixel = image.cropping(to: CGRect(x: x, y: y, width: 1, height: 1)),
                let context = CGContext(
                    data: nil, width: 1, height: 1, bitsPerComponent: 8, bytesPerRow: 4,
                    space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
            else { return false }
            context.draw(pixel, in: CGRect(x: 0, y: 0, width: 1, height: 1))
            let rgba = context.data!.assumingMemoryBound(to: UInt8.self)
            if rgba[1] <= 30 || Double(rgba[1]) <= Double(rgba[0]) * 1.1 {
                print("FAIL: green canvas does not reach display edge \(x),\(y) in \(path)")
                filled = false
            }
        }
        if filled { print("PASS: native \(w)×\(h) canvas reaches all four display edges") }
        return filled
    }

    static func main() {
        let proposals: [(CGSize, PanelCanvasProfile)] = [
            (CGSize(width: 1366, height: 1024), .spacious),
            (CGSize(width: 466, height: 678), .compact),
            (CGSize(width: 951, height: 669), .regular),
            (CGSize(width: 466, height: 1200), .compact),
            (CGSize(width: 600, height: 951), .regular),
            (CGSize(width: 320, height: 600), .compact),
        ]
        for (size, expected) in proposals {
            let profile = PanelCanvasProfile.resolve(size: size)
            precondition(profile == expected)
            let launcher = LauncherLayout(profile: profile, availableWidth: size.width)
            let occupied =
                CGFloat(launcher.columns) * max(launcher.iconFrameSide, launcher.labelSize * 6)
                + CGFloat(launcher.columns - 1) * 28 + launcher.horizontalInset * 2
            precondition(occupied <= size.width, "Launcher must fit the actual proposal")
            print("PASS: \(profile.rawValue) \(Int(size.width))×\(Int(size.height)), \(launcher.columns) columns")
        }
        var rendered = true
        for path in CommandLine.arguments.dropFirst() {
            if !checkRendering(path) { rendered = false }
        }
        if !rendered { exit(1) }
    }
}
