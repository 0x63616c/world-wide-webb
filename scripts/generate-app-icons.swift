#!/usr/bin/env swift
import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

// Run from the repository root with the pinned macOS/Xcode toolchain.
// SVG geometry is the source of truth. iOS applies the corner mask, not this artwork.
struct Shape {
  let id: String
  let points: [CGPoint]
}
final class Geometry: NSObject, XMLParserDelegate {
  var shapes: [Shape] = []
  func parser(
    _ parser: XMLParser, didStartElement elementName: String,
    namespaceURI: String?, qualifiedName: String?, attributes: [String: String]
  ) {
    guard elementName == "polygon", let id = attributes["id"],
      let raw = attributes["points"]
    else { return }
    let points = raw.split(separator: " ").compactMap { point -> CGPoint? in
      let pair = point.split(separator: ",").compactMap { Double($0) }
      guard pair.count == 2 else { return nil }
      return CGPoint(x: pair[0], y: pair[1])
    }
    shapes.append(Shape(id: id, points: points))
  }
}
func color(_ hex: UInt32) -> CGColor {
  CGColor(
    colorSpace: CGColorSpace(name: CGColorSpace.sRGB)!,
    components: [
      CGFloat((hex >> 16) & 255) / 255, CGFloat((hex >> 8) & 255) / 255,
      CGFloat(hex & 255) / 255, 1,
    ])!
}
let root = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
let source = root.appendingPathComponent("apps/ios/Branding/mark.svg")
let geometry = Geometry()
let parser = XMLParser(data: try Data(contentsOf: source))
parser.delegate = geometry
guard parser.parse(), Set(geometry.shapes.map(\.id)) == ["left", "right", "top"],
  geometry.shapes.allSatisfy({ $0.points.count == 4 })
else { fatalError("Invalid icon vector geometry") }
let output = root.appendingPathComponent("apps/ios/App/Assets.xcassets/AppIcon.appiconset")
let variants: [(name: String, background: UInt32?, paper: UInt32, top: UInt32)] = [
  ("AppIcon", 0x2263e9, 0xffffff, 0xb4d2ff),
  ("AppIcon-Dark", nil, 0x74aaff, 0xc3dcff),
  ("AppIcon-Tinted", 0x000000, 0xffffff, 0xbababa),
]
for variant in variants {
  let alpha: CGImageAlphaInfo = variant.background == nil ? .premultipliedLast : .noneSkipLast
  guard
    let context = CGContext(
      data: nil, width: 1024, height: 1024, bitsPerComponent: 8, bytesPerRow: 4096,
      space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: alpha.rawValue)
  else { fatalError("Cannot create icon canvas") }
  if let background = variant.background {
    context.setFillColor(color(background))
    context.fill(CGRect(x: 0, y: 0, width: 1024, height: 1024))
  }
  context.translateBy(x: 0, y: 1024)
  context.scaleBy(x: 16, y: -16)
  context.setShouldAntialias(true)
  for shape in geometry.shapes {
    context.setFillColor(color(shape.id == "top" ? variant.top : variant.paper))
    context.beginPath()
    context.addLines(between: shape.points)
    context.closePath()
    context.fillPath()
  }
  guard let image = context.makeImage() else { fatalError("Cannot render icon") }
  let encoded = NSMutableData()
  guard
    let destination = CGImageDestinationCreateWithData(
      encoded, UTType.png.identifier as CFString, 1, nil)
  else { fatalError("Cannot encode icon") }
  CGImageDestinationAddImage(destination, image, nil)
  guard CGImageDestinationFinalize(destination) else { fatalError("Cannot finish icon") }
  let url = output.appendingPathComponent(variant.name + ".png")
  if CommandLine.arguments.contains("--check") {
    guard try Data(contentsOf: url) == encoded as Data else {
      fatalError("Icon is stale: \(variant.name). Run scripts/generate-app-icons.swift")
    }
  } else {
    try (encoded as Data).write(to: url, options: .atomic)
  }
}
print("App icons: three 1024px variants match vector geometry.")
