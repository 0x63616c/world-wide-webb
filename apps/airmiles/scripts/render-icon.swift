// Run from the repository root: swift apps/airmiles/scripts/render-icon.swift
import AppKit
let size = NSSize(width: 1024, height: 1024)
let context = CGContext(data: nil, width: 1024, height: 1024, bitsPerComponent: 8, bytesPerRow: 4096, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)!
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(cgContext: context, flipped: false)
NSColor(white: 0.06, alpha: 1).setFill()
NSBezierPath(rect: NSRect(origin: .zero, size: size)).fill()
let ring = NSBezierPath(ovalIn: NSRect(x: 152, y: 152, width: 720, height: 720))
NSColor(white: 0.35, alpha: 1).setStroke()
ring.lineWidth = 2
ring.stroke()
let inner = NSBezierPath(ovalIn: NSRect(x: 272, y: 152, width: 480, height: 720))
inner.lineWidth = 2; inner.stroke()
let latitude = NSBezierPath(ovalIn: NSRect(x: 152, y: 360, width: 720, height: 300))
latitude.lineWidth = 2; latitude.stroke()
let config = NSImage.SymbolConfiguration(pointSize: 420, weight: .light).applying(.init(paletteColors: [NSColor(white: 0.96, alpha: 1)]))
let plane = NSImage(systemSymbolName: "airplane", accessibilityDescription: nil)!.withSymbolConfiguration(config)!
let transform = NSAffineTransform()
transform.translateX(by: 512, yBy: 512)
transform.rotate(byDegrees: 35)
transform.concat()
plane.draw(in: NSRect(x: -260, y: -240, width: 520, height: 480))
NSGraphicsContext.restoreGraphicsState()
let rep = NSBitmapImageRep(cgImage: context.makeImage()!)
try rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: "apps/airmiles/App/Assets.xcassets/AppIcon.appiconset/AppIcon.png"))
