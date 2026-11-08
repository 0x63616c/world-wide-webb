// Renders the Tendr "Cycle" mark: a white monoline T inside a grey ring that is 6/7 complete
// (one week, one dose to go), on a near-black tile. Monochrome only.
// Every icon asset comes from the geometry below; edit it here, then run from the repo root:
//
//   swift apps/tendr/scripts/render-icon.swift
//
// Writes design/icon/*.svg and *.png, the AppIcon set (any, dark and tinted; 1024, opaque),
// the LaunchGlyph image set and the site icons. CI (icon.yml) fails if the committed files differ.
import AppKit
import UniformTypeIdentifiers

/// Geometry in a 1024 × 1024 design space, y pointing down.
enum Mark {
    static let size = 1024.0
    static let centre = 512.0
    static let ringRadius = 300.0
    static let stroke = 46.0
    /// The ring starts at 12 o'clock and runs clockwise for six sevenths of a turn.
    static let ringFraction = 6.0 / 7.0
    static let barY = 400.0
    static let barHalfWidth = 116.0
    static let stemBottom = 642.0
}

struct Palette {
    let tile: CGColor?
    let ring: CGColor
    let glyph: CGColor
    static func grey(_ white: CGFloat) -> CGColor { CGColor(gray: white, alpha: 1) }
    static let dark = Palette(tile: grey(0.055), ring: grey(0.45), glyph: grey(0.95))
    static let light = Palette(tile: CGColor(srgbRed: 0.96, green: 0.96, blue: 0.98, alpha: 1), ring: grey(0.62), glyph: grey(0.055))
    /// iOS 18 tinted icons are grayscale; the system applies the tint.
    static let tinted = Palette(tile: grey(0), ring: grey(0.55), glyph: grey(1))
    static let launch = Palette(tile: nil, ring: grey(0.45), glyph: grey(0.95))
}

func hex(_ color: CGColor) -> String {
    let rgb = color.converted(to: CGColorSpace(name: CGColorSpace.sRGB)!, intent: .defaultIntent, options: nil)!.components!
    return "#" + rgb.prefix(3).map { String(format: "%02X", Int(($0 * 255).rounded())) }.joined()
}

func svg(_ palette: Palette) -> String {
    let m = Mark.self
    let sweep = 2 * Double.pi * m.ringFraction
    let end = (x: m.centre + m.ringRadius * sin(sweep), y: m.centre - m.ringRadius * cos(sweep))
    let tile = palette.tile.map { "  <rect width=\"1024\" height=\"1024\" fill=\"\(hex($0))\"/>\n" } ?? ""
    return """
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">
    \(tile)  <g fill="none" stroke-width="\(Int(m.stroke))" stroke-linecap="round" stroke-linejoin="round">
        <path d="M \(Int(m.centre)) \(Int(m.centre - m.ringRadius)) A \(Int(m.ringRadius)) \(Int(m.ringRadius)) 0 1 1 \(String(format: "%.2f", end.x)) \(String(format: "%.2f", end.y))" stroke="\(hex(palette.ring))"/>
        <path d="M \(Int(m.centre - m.barHalfWidth)) \(Int(m.barY)) H \(Int(m.centre + m.barHalfWidth)) M \(Int(m.centre)) \(Int(m.barY)) V \(Int(m.stemBottom))" stroke="\(hex(palette.glyph))"/>
      </g>
    </svg>

    """
}

/// Draws the mark into a square bitmap. `inset` shrinks the design space (used for the launch glyph).
func render(_ palette: Palette, pixels: Int, inset: Double = 0) -> CGImage {
    let opaque = palette.tile != nil
    let context = CGContext(data: nil, width: pixels, height: pixels, bitsPerComponent: 8, bytesPerRow: 0,
                            space: CGColorSpace(name: CGColorSpace.sRGB)!,
                            bitmapInfo: (opaque ? CGImageAlphaInfo.noneSkipLast : .premultipliedLast).rawValue)!
    let scale = Double(pixels) / (Mark.size - 2 * inset)
    // Flip to the y-down design space so the maths matches the SVG.
    context.translateBy(x: 0, y: CGFloat(pixels))
    context.scaleBy(x: CGFloat(scale), y: CGFloat(-scale))
    context.translateBy(x: CGFloat(-inset), y: CGFloat(-inset))
    if let tile = palette.tile {
        context.setFillColor(tile)
        context.fill(CGRect(x: 0, y: 0, width: Mark.size, height: Mark.size))
    }
    context.setLineWidth(Mark.stroke)
    context.setLineCap(.round)
    context.setLineJoin(.round)

    let ring = CGMutablePath()
    let start = -Double.pi / 2
    // In the flipped space, increasing angles run clockwise on screen.
    ring.addArc(center: CGPoint(x: Mark.centre, y: Mark.centre), radius: Mark.ringRadius,
                startAngle: start, endAngle: start + 2 * .pi * Mark.ringFraction, clockwise: false)
    context.addPath(ring)
    context.setStrokeColor(palette.ring)
    context.strokePath()

    let glyph = CGMutablePath()
    glyph.move(to: CGPoint(x: Mark.centre - Mark.barHalfWidth, y: Mark.barY))
    glyph.addLine(to: CGPoint(x: Mark.centre + Mark.barHalfWidth, y: Mark.barY))
    glyph.move(to: CGPoint(x: Mark.centre, y: Mark.barY))
    glyph.addLine(to: CGPoint(x: Mark.centre, y: Mark.stemBottom))
    context.addPath(glyph)
    context.setStrokeColor(palette.glyph)
    context.strokePath()
    return context.makeImage()!
}

func write(_ image: CGImage, to path: String) throws {
    let url = URL(fileURLWithPath: path)
    try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
    guard let destination = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil) else { throw CocoaError(.fileWriteUnknown) }
    CGImageDestinationAddImage(destination, image, nil)
    guard CGImageDestinationFinalize(destination) else { throw CocoaError(.fileWriteUnknown) }
    print("Wrote \(path)")
}

func write(_ text: String, to path: String) throws {
    try FileManager.default.createDirectory(atPath: (path as NSString).deletingLastPathComponent, withIntermediateDirectories: true)
    try text.write(toFile: path, atomically: true, encoding: .utf8)
    print("Wrote \(path)")
}

FileManager.default.changeCurrentDirectoryPath(CommandLine.arguments.dropFirst().first ?? ".")
let appIcon = "apps/tendr/Still/Assets.xcassets/AppIcon.appiconset"
let launch = "apps/tendr/Still/Assets.xcassets/LaunchGlyph.imageset"
do {
    try write(svg(.launch), to: "apps/tendr/design/icon/cycle-glyph.svg")
    try write(svg(.dark), to: "apps/tendr/design/icon/tendr-icon-dark.svg")
    try write(svg(.light), to: "apps/tendr/design/icon/tendr-icon-light.svg")
    try write(render(.dark, pixels: 1024), to: "apps/tendr/design/icon/tendr-icon-dark-1024.png")
    try write(render(.light, pixels: 1024), to: "apps/tendr/design/icon/tendr-icon-light-1024.png")

    try write(render(.dark, pixels: 1024), to: "\(appIcon)/AppIcon.png")
    try write(render(.dark, pixels: 1024), to: "\(appIcon)/AppIcon-Dark.png")
    try write(render(.tinted, pixels: 1024), to: "\(appIcon)/AppIcon-Tinted.png")

    // 120 pt glyph, trimmed to the ring with a little breathing room.
    let ringInset = Mark.centre - Mark.ringRadius - Mark.stroke / 2 - 8
    for scale in 1...3 {
        try write(render(.launch, pixels: 120 * scale, inset: ringInset), to: "\(launch)/LaunchGlyph\(scale == 1 ? "" : "@\(scale)x").png")
    }

    try write(render(.dark, pixels: 256), to: "site/tendr/assets/icon-256.png")
    try write(render(.dark, pixels: 180), to: "site/tendr/assets/apple-touch-icon.png")
    try write(render(.dark, pixels: 64), to: "site/tendr/assets/favicon-64.png")
} catch {
    FileHandle.standardError.write(Data("render-icon: \(error)\n".utf8))
    exit(1)
}
