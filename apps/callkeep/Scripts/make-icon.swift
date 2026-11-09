import AppKit
import Foundation
let root = URL(fileURLWithPath: CommandLine.arguments[1])
try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
var entries: [[String: String]] = []
for points in [16, 32, 128, 256, 512] {
    for scale in [1, 2] {
        let pixels = points * scale
        let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: pixels, pixelsHigh: pixels, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
        let transform = NSAffineTransform(); transform.scale(by: CGFloat(pixels) / 1024); transform.concat()
        let bounds = NSRect(x: 52, y: 52, width: 920, height: 920)
        let background = NSBezierPath(roundedRect: bounds, xRadius: 210, yRadius: 210)
        let shadow = NSShadow(); shadow.shadowColor = NSColor.black.withAlphaComponent(0.24); shadow.shadowBlurRadius = 28; shadow.shadowOffset = NSSize(width: 0, height: -10)
        NSGraphicsContext.saveGraphicsState(); shadow.set()
        NSColor(calibratedRed: 0.20, green: 0.21, blue: 0.66, alpha: 1).setFill(); background.fill(); NSGraphicsContext.restoreGraphicsState()
        NSGradient(colors: [NSColor(calibratedRed: 0.46, green: 0.46, blue: 0.96, alpha: 1), NSColor(calibratedRed: 0.23, green: 0.22, blue: 0.70, alpha: 1)])!.draw(in: background, angle: -70)
        NSColor.white.withAlphaComponent(0.16).setStroke(); background.lineWidth = 3; background.stroke()
        let heights: [CGFloat] = [160, 300, 450, 250, 360]
        NSColor.white.setFill()
        for (i, height) in heights.enumerated() { NSBezierPath(roundedRect: NSRect(x: 272 + CGFloat(i) * 100, y: 512 - height / 2, width: 64, height: height), xRadius: 32, yRadius: 32).fill() }
        NSGraphicsContext.restoreGraphicsState()
        let file = "icon_\(points)x\(points)@\(scale)x.png"
        try rep.representation(using: .png, properties: [:])!.write(to: root.appendingPathComponent(file))
        entries.append(["idiom": "mac", "size": "\(points)x\(points)", "scale": "\(scale)x", "filename": file])
    }
}
try JSONSerialization.data(withJSONObject: ["images": entries, "info": ["author": "xcode", "version": 1]], options: [.prettyPrinted, .sortedKeys]).write(to: root.appendingPathComponent("Contents.json"))
