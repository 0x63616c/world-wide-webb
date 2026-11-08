import AppKit
import UniformTypeIdentifiers

// Adapted from 0x63616c/apps packages/RDesign/Sources/rframe/RFrame.swift.
// The entire native Duo capture stays visible; the frame adds no fabricated controls.
let arguments = CommandLine.arguments
precondition(
  arguments.count == 9, "Expected source destination width height headline eyebrow appearance style"
)
struct FrameStyle: Decodable {
  let topInset: Double
  let sideInset: Double
  let headlineSize: Double
  let labelSize: Double
  let labelTracking: Double
  let headlineGap: Double
  let deviceGap: Double
  let bottomInset: Double
}
let style = try JSONDecoder().decode(
  FrameStyle.self, from: Data(contentsOf: URL(fileURLWithPath: arguments[8])))
guard let source = NSImage(contentsOfFile: arguments[1]),
  let width = Int(arguments[3]), let height = Int(arguments[4]),
  width > 0, height > 0, ["light", "dark"].contains(arguments[7]),
  let bitmap = NSBitmapImageRep(
    bitmapDataPlanes: nil, pixelsWide: width, pixelsHigh: height,
    bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true,
    isPlanar: false, colorSpaceName: .deviceRGB,
    bytesPerRow: 0, bitsPerPixel: 0),
  let context = NSGraphicsContext(bitmapImageRep: bitmap)
else { fatalError("Invalid screenshot input") }
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = context
context.imageInterpolation = .high
let w = CGFloat(width)
let h = CGFloat(height)
let dark = arguments[7] == "dark"
NSColor(calibratedWhite: dark ? 0.055 : 0.96, alpha: 1).setFill()
NSRect(x: 0, y: 0, width: w, height: h).fill()
let margin = w * style.sideInset
let textWidth = w - 2 * margin
let paragraph = NSMutableParagraphStyle()
paragraph.alignment = .center
paragraph.lineBreakMode = .byWordWrapping
func text(_ value: String, size: CGFloat, ink: CGFloat, tracking: CGFloat = 0) -> NSAttributedString
{
  NSAttributedString(
    string: value,
    attributes: [
      .font: NSFont.systemFont(ofSize: size, weight: .bold),
      .foregroundColor: NSColor(calibratedWhite: ink, alpha: 1),
      .kern: tracking, .paragraphStyle: paragraph,
    ])
}
let top = h - h * style.topInset
let label = text(
  arguments[6].uppercased(), size: w * style.labelSize,
  ink: dark ? 0.72 : 0.28, tracking: w * style.labelTracking)
let labelHeight = ceil(
  label.boundingRect(
    with: NSSize(width: textWidth, height: h), options: [.usesLineFragmentOrigin, .usesFontLeading]
  ).height)
label.draw(
  with: NSRect(x: margin, y: top - labelHeight, width: textWidth, height: labelHeight),
  options: [.usesLineFragmentOrigin, .usesFontLeading])
// Shrink long translations until they fit two lines; never truncate store copy.
var fontSize = w * style.headlineSize
var headline: NSAttributedString
var headlineHeight: CGFloat
repeat {
  headline = text(arguments[5], size: fontSize, ink: dark ? 0.95 : 0.055, tracking: -w * 0.0012)
  headlineHeight = ceil(
    headline.boundingRect(
      with: NSSize(width: textWidth, height: h),
      options: [.usesLineFragmentOrigin, .usesFontLeading]
    ).height)
  if headlineHeight <= fontSize * 2.5 { break }
  fontSize -= 1
} while fontSize > w * 0.035
precondition(headlineHeight <= fontSize * 2.5, "Headline exceeds two lines")
let headlineTop = top - labelHeight - w * style.headlineGap
headline.draw(
  with: NSRect(
    x: margin, y: headlineTop - headlineHeight, width: textWidth, height: headlineHeight),
  options: [.usesLineFragmentOrigin, .usesFontLeading])
let availableTop = headlineTop - headlineHeight - w * style.deviceGap
let bottom = h * style.bottomInset
let bezel = w * 0.018
let available = NSRect(
  x: margin + bezel, y: bottom + bezel,
  width: textWidth - 2 * bezel, height: availableTop - bottom - 2 * bezel)
precondition(available.height > 0, "No space for app capture")
let ratio = min(available.width / source.size.width, available.height / source.size.height)
let scaled = NSSize(width: source.size.width * ratio, height: source.size.height * ratio)
let screen = NSRect(
  x: available.midX - scaled.width / 2, y: available.midY - scaled.height / 2, width: scaled.width,
  height: scaled.height)
let body = screen.insetBy(dx: -bezel, dy: -bezel)
let radius = bezel * 0.7
NSGraphicsContext.saveGraphicsState()
let shadow = NSShadow()
shadow.shadowColor = NSColor.black.withAlphaComponent(dark ? 0.55 : 0.2)
shadow.shadowBlurRadius = w * 0.035
shadow.shadowOffset = NSSize(width: 0, height: -w * 0.018)
shadow.set()
NSColor(calibratedWhite: 0.32, alpha: 1).setFill()
NSBezierPath(roundedRect: body, xRadius: radius + bezel, yRadius: radius + bezel).fill()
NSGraphicsContext.restoreGraphicsState()
NSColor.black.setFill()
NSBezierPath(
  roundedRect: body.insetBy(dx: w * 0.003, dy: w * 0.003), xRadius: radius + bezel,
  yRadius: radius + bezel
).fill()
// Preserve all source pixels, including the native status bar, with no screenshot crop.
source.draw(in: screen, from: .zero, operation: .sourceOver, fraction: 1)
NSGraphicsContext.restoreGraphicsState()
let destinationURL = URL(fileURLWithPath: arguments[2])
precondition(!FileManager.default.fileExists(atPath: destinationURL.path), "Output already exists")
guard let image = bitmap.cgImage,
  let opaqueContext = CGContext(
    data: nil, width: width, height: height, bitsPerComponent: 8,
    bytesPerRow: 0, space: CGColorSpace(name: CGColorSpace.sRGB)!,
    bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)
else { fatalError("Cannot create opaque sRGB output") }
opaqueContext.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
guard let opaque = opaqueContext.makeImage(),
  let destination = CGImageDestinationCreateWithURL(
    destinationURL as CFURL, UTType.png.identifier as CFString, 1, nil)
else { fatalError("PNG encoding failed") }
CGImageDestinationAddImage(destination, opaque, nil)
precondition(CGImageDestinationFinalize(destination), "PNG write failed")
