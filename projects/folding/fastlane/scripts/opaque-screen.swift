import CoreGraphics
import Darwin
import Foundation
import ImageIO
import UniformTypeIdentifiers

// App Store PNGs cannot contain an alpha channel. Remove only fully opaque
// alpha, retaining native dimensions, RGB pixels and the source color space.
precondition(CommandLine.arguments.count == 3, "Expected source and destination PNG")
let sourceURL = URL(fileURLWithPath: CommandLine.arguments[1])
let destinationURL = URL(fileURLWithPath: CommandLine.arguments[2])
precondition(!FileManager.default.fileExists(atPath: destinationURL.path), "Output already exists")
guard let source = CGImageSourceCreateWithURL(sourceURL as CFURL, nil),
  let image = CGImageSourceCreateImageAtIndex(source, 0, nil),
  image.bitsPerComponent == 8, let colorSpace = image.colorSpace,
  colorSpace.model == .rgb
else { fatalError("Expected an eight-bit RGB simulator PNG") }
func rgba(_ image: CGImage) -> [UInt8] {
  var bytes = [UInt8](repeating: 0, count: image.width * image.height * 4)
  bytes.withUnsafeMutableBytes { buffer in
    guard
      let context = CGContext(
        data: buffer.baseAddress, width: image.width, height: image.height,
        bitsPerComponent: 8, bytesPerRow: image.width * 4, space: colorSpace,
        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
          | CGBitmapInfo.byteOrder32Big.rawValue
      )
    else { fatalError("Cannot decode native screenshot pixels") }
    context.draw(image, in: CGRect(x: 0, y: 0, width: image.width, height: image.height))
  }
  return bytes
}
let original = rgba(image)
var rgb = [UInt8]()
rgb.reserveCapacity(image.width * image.height * 3)
for offset in stride(from: 0, to: original.count, by: 4) {
  guard original[offset + 3] == 255 else {
    FileHandle.standardError.write(Data("Simulator screenshot contains transparent pixels\n".utf8))
    exit(65)
  }
  rgb.append(contentsOf: original[offset..<(offset + 3)])
}
guard let provider = CGDataProvider(data: Data(rgb) as CFData),
  let opaque = CGImage(
    width: image.width, height: image.height, bitsPerComponent: 8, bitsPerPixel: 24,
    bytesPerRow: image.width * 3, space: colorSpace,
    bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.none.rawValue),
    provider: provider, decode: nil, shouldInterpolate: false, intent: image.renderingIntent)
else { fatalError("Cannot remove opaque alpha") }
let data = NSMutableData()
guard
  let destination = CGImageDestinationCreateWithData(
    data, UTType.png.identifier as CFString, 1, nil)
else { fatalError("Cannot encode native screenshot") }
CGImageDestinationAddImage(destination, opaque, nil)
precondition(CGImageDestinationFinalize(destination), "PNG encoding failed")
guard let encoded = CGImageSourceCreateWithData(data, nil),
  let result = CGImageSourceCreateImageAtIndex(encoded, 0, nil)
else { fatalError("Cannot verify encoded PNG") }
precondition(rgba(result) == original, "PNG encoding changed native screenshot pixels")
precondition((data as Data)[25] == 2, "Expected PNG without an alpha channel")
try (data as Data).write(to: destinationURL, options: .withoutOverwriting)
