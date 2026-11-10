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
// Match Extension/icon.svg's custom mark, optically centered on an unmasked
// square. The operating system supplies the app icon's rounded corners.
let transform = NSAffineTransform()
transform.transformStruct = NSAffineTransformStruct(
  m11: 8, m12: 0, m21: 0, m22: -8, tX: -8, tY: 1084)
transform.concat()
let mark = NSBezierPath()
mark.appendRect(NSRect(x: 34, y: 49, width: 25, height: 30))
mark.move(to: NSPoint(x: 34, y: 79))
mark.line(to: NSPoint(x: 34, y: 94))
mark.line(to: NSPoint(x: 59, y: 94))
mark.line(to: NSPoint(x: 59, y: 79))
mark.appendRect(NSRect(x: 78, y: 49, width: 18, height: 30))
mark.lineWidth = 9
mark.lineJoinStyle = .round
NSColor.white.setStroke()
mark.stroke()
NSGraphicsContext.restoreGraphicsState()
bitmap.setProperty(.colorSyncProfileData, withValue: NSColorSpace.sRGB.iccProfileData)
try bitmap.representation(using: .png, properties: [:])!.write(
  to: output.appendingPathComponent("icon.png"))
let contents = """
  {"images":[{"filename":"icon.png","idiom":"universal","platform":"ios","size":"1024x1024"},{"filename":"icon.png","idiom":"mac","scale":"2x","size":"512x512"}],"info":{"author":"xcode","version":1}}
  """
try contents.write(
  to: output.appendingPathComponent("Contents.json"), atomically: true, encoding: .utf8)
