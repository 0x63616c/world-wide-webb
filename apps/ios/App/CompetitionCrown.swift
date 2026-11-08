import SwiftUI
import UIKit

/// The selected tilted cartoon artwork, sharing one silhouette across podium metals.
@MainActor struct CompetitionCrown: View {
  let medal: CompetitionMedal
  var body: some View {
    if let image = Self.artwork[medal] {
      Image(uiImage: image).resizable().scaledToFit()
        .rotationEffect(.degrees(12), anchor: .bottom)
        .accessibilityLabel(medal.title)
    }
  }

  private static let artwork: [CompetitionMedal: UIImage] = {
    guard let atlas = UIImage(named: "CompetitionCrowns")?.cgImage else { return [:] }
    let side = atlas.width / 3
    var images: [CompetitionMedal: UIImage] = [:]
    for (index, medal) in [CompetitionMedal.gold, .silver, .bronze].enumerated() {
      guard
        let cell = atlas.cropping(
          to: CGRect(x: index * side, y: 0, width: side, height: atlas.height))
      else { continue }
      let width = cell.width
      let height = cell.height
      var pixels = [UInt8](repeating: 0, count: width * height * 4)
      let bounds = pixels.withUnsafeMutableBytes { buffer -> CGRect? in
        guard
          let context = CGContext(
            data: buffer.baseAddress, width: width, height: height, bitsPerComponent: 8,
            bytesPerRow: width * 4, space: CGColorSpaceCreateDeviceRGB(),
            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
              | CGBitmapInfo.byteOrder32Big.rawValue)
        else { return nil }
        context.draw(cell, in: CGRect(x: 0, y: 0, width: width, height: height))
        let bytes = buffer.bindMemory(to: UInt8.self)
        var left = width
        var right = 0
        var bottom = height
        var top = 0
        for y in 0..<height {
          for x in 0..<width where bytes[(y * width + x) * 4 + 3] > 16 {
            left = min(left, x)
            right = max(right, x)
            bottom = min(bottom, y)
            top = max(top, y)
          }
        }
        guard left <= right, bottom <= top else { return nil }
        // Context scanlines are bottom-up; CGImage crop coordinates are top-down.
        return CGRect(
          x: left, y: height - top - 1, width: right - left + 1, height: top - bottom + 1)
      }
      if let bounds, let cropped = cell.cropping(to: bounds) {
        images[medal] = UIImage(cgImage: cropped)
      }
    }
    return images
  }()
}

@MainActor struct PodiumRing: View {
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  let medal: CompetitionMedal
  let size: CGFloat

  private var color: Color {
    switch medal {
    case .gold: Color(red: 1, green: 0.76, blue: 0.12)
    case .silver: Color(red: 0.59, green: 0.63, blue: 0.68)
    case .bronze: Color(red: 0.62, green: 0.37, blue: 0.20)
    }
  }

  var body: some View {
    Group {
      if medal == .gold, !reduceMotion {
        TimelineView(.animation(minimumInterval: 1.0 / 24)) { context in
          let phase =
            context.date.timeIntervalSinceReferenceDate.truncatingRemainder(dividingBy: 4) / 4
          ZStack {
            ring
            Circle().stroke(
              AngularGradient(
                colors: [color, color, Color(red: 1, green: 0.94, blue: 0.62), color, color],
                center: .center), lineWidth: 2.5
            )
            .rotationEffect(.degrees(phase * 360))
            .padding(-4)
            ForEach(0..<3) { index in
              let pulse = pow(max(0, sin((phase + Double(index) / 3) * .pi * 2)), 3)
              Image(systemName: "sparkle")
                .font(.system(size: index == 0 ? 8 : 5, weight: .semibold))
                .foregroundStyle(Color(red: 1, green: 0.85, blue: 0.35))
                .opacity(pulse)
                .scaleEffect(0.65 + pulse * 0.35)
                .offset(
                  x: [-0.55, -0.15, 0.54][index] * size,
                  y: [-0.30, -0.60, -0.15][index] * size - pulse * 3)
            }
          }
        }
      } else {
        ring
      }
    }
    .allowsHitTesting(false)
    .accessibilityHidden(true)
  }

  private var ring: some View {
    Circle().stroke(color, lineWidth: medal == .gold ? 2.5 : 1.5)
      .padding(-4)
      .shadow(color: medal == .gold ? color.opacity(0.25) : .clear, radius: 3)
  }
}
