import AppKit

// Caption composition preserves every source UI pixel and aspect ratio.
// The medium upload canvas explicitly remains a Duo capture in its manifest.
let arguments = CommandLine.arguments
precondition(arguments.count == 6, "Expected source destination width height caption")
guard let source = NSImage(contentsOfFile: arguments[1]),
  let width = Int(arguments[3]), let height = Int(arguments[4]),
  width > 0, height > 0,
  let bitmap = NSBitmapImageRep(
    bitmapDataPlanes: nil, pixelsWide: width, pixelsHigh: height,
    bitsPerSample: 8, samplesPerPixel: 3, hasAlpha: false,
    isPlanar: false, colorSpaceName: .deviceRGB,
    bytesPerRow: 0, bitsPerPixel: 0),
  let context = NSGraphicsContext(bitmapImageRep: bitmap)
else { fatalError("Invalid screenshot input") }
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = context
context.imageInterpolation = .high
let canvas = NSRect(x: 0, y: 0, width: width, height: height)
NSColor(calibratedWhite: 0.965, alpha: 1).setFill()
canvas.fill()
let margin = CGFloat(width) * 0.065
let captionHeight = CGFloat(height) * 0.14
let paragraph = NSMutableParagraphStyle()
paragraph.alignment = .center
let caption = NSAttributedString(
  string: arguments[5],
  attributes: [
    .font: NSFont.systemFont(ofSize: CGFloat(width) * 0.058, weight: .semibold),
    .foregroundColor: NSColor(calibratedWhite: 0.09, alpha: 1), .paragraphStyle: paragraph,
  ])
caption.draw(
  with: NSRect(
    x: margin, y: CGFloat(height) - captionHeight - margin,
    width: CGFloat(width) - 2 * margin, height: captionHeight),
  options: [.usesLineFragmentOrigin, .usesFontLeading])
let available = NSRect(
  x: margin, y: margin, width: CGFloat(width) - 2 * margin,
  height: CGFloat(height) - captionHeight - 3 * margin)
let ratio = min(available.width / source.size.width, available.height / source.size.height)
let scaled = NSSize(width: source.size.width * ratio, height: source.size.height * ratio)
let frame = NSRect(
  x: available.midX - scaled.width / 2, y: available.midY - scaled.height / 2,
  width: scaled.width, height: scaled.height)
source.draw(in: frame, from: .zero, operation: .sourceOver, fraction: 1)
NSGraphicsContext.restoreGraphicsState()
guard let png = bitmap.representation(using: .png, properties: [:]) else {
  fatalError("PNG encoding failed")
}
try png.write(to: URL(fileURLWithPath: arguments[2]), options: .withoutOverwriting)
