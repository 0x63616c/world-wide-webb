#!/usr/bin/env swift
import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

// Resize the selected brand image for every iOS appearance variant.
// iOS applies the rounded icon mask; the artwork keeps its square black canvas.
let root = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
let source = root.appendingPathComponent("apps/ios/Branding/icon-selected.png")
guard let imageSource = CGImageSourceCreateWithURL(source as CFURL, nil),
  let image = CGImageSourceCreateImageAtIndex(imageSource, 0, nil),
  image.width == image.height, image.width >= 1024
else { fatalError("Selected icon must be square and at least 1024 pixels") }
let output = root.appendingPathComponent("apps/ios/App/Assets.xcassets/AppIcon.appiconset")
for name in ["AppIcon", "AppIcon-Dark", "AppIcon-Tinted"] {
  guard
    let context = CGContext(
      data: nil, width: 1024, height: 1024, bitsPerComponent: 8, bytesPerRow: 4096,
      space: CGColorSpace(name: CGColorSpace.sRGB)!,
      bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)
  else { fatalError("Cannot create icon canvas") }
  context.interpolationQuality = .high
  context.setFillColor(CGColor(gray: 0, alpha: 1))
  context.fill(CGRect(x: 0, y: 0, width: 1024, height: 1024))
  // The selected mark has slightly more black space below it; lower it by 5 px.
  context.draw(image, in: CGRect(x: 0, y: -5, width: 1024, height: 1024))
  guard let rendered = context.makeImage() else { fatalError("Cannot render icon") }
  let encoded = NSMutableData()
  guard
    let destination = CGImageDestinationCreateWithData(
      encoded, UTType.png.identifier as CFString, 1, nil)
  else { fatalError("Cannot encode icon") }
  CGImageDestinationAddImage(destination, rendered, nil)
  guard CGImageDestinationFinalize(destination) else { fatalError("Cannot finish icon") }
  let url = output.appendingPathComponent(name + ".png")
  if CommandLine.arguments.contains("--check") {
    guard try Data(contentsOf: url) == encoded as Data else {
      fatalError("Icon is stale: \(name). Run scripts/generate-app-icons.swift")
    }
  } else {
    try (encoded as Data).write(to: url, options: .atomic)
  }
}
print("App icons: three 1024px variants match the selected brand image.")
