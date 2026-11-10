import AppKit

// Reproducible native app icon; the Safari toolbar uses Extension/icon.svg.
let output = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
try FileManager.default.createDirectory(at: output, withIntermediateDirectories: true)
let bitmap = NSBitmapImageRep(
  bitmapDataPlanes: nil, pixelsWide: 1024, pixelsHigh: 1024,
  bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
  colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0
)!
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: bitmap)
NSColor(red: 37 / 255, green: 99 / 255, blue: 235 / 255, alpha: 1).setFill()
NSRect(x: 0, y: 0, width: 1024, height: 1024).fill()
let text: NSString = "go"
let attributes: [NSAttributedString.Key: Any] = [
  .font: NSFont.systemFont(ofSize: 560, weight: .bold), .foregroundColor: NSColor.white,
]
let size = text.size(withAttributes: attributes)
text.draw(
  at: NSPoint(x: (1024 - size.width) / 2, y: (1024 - size.height) / 2 + 35),
  withAttributes: attributes)
NSGraphicsContext.restoreGraphicsState()
try bitmap.representation(using: .png, properties: [:])!.write(
  to: output.appendingPathComponent("icon.png"))
let contents = """
  {"images":[{"filename":"icon.png","idiom":"universal","platform":"ios","size":"1024x1024"},{"filename":"icon.png","idiom":"mac","scale":"2x","size":"512x512"}],"info":{"author":"xcode","version":1}}
  """
try contents.write(
  to: output.appendingPathComponent("Contents.json"), atomically: true, encoding: .utf8)
