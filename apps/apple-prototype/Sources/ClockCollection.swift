import CoreText
import SwiftUI
#if os(macOS)
import AppKit
#else
import UIKit
#endif

/// Oversized stacked numerals and a continuous blue colour field, like a typographic poster.
struct TideClockDial: View {
    let date: Date
    let night: Bool
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    @Environment(\.colorSchemeContrast) private var contrast

    private var glass: Glass {
        #if DEBUG
        if let index = ProcessInfo.processInfo.arguments.firstIndex(of: "-tideGlassPreview"),
           ProcessInfo.processInfo.arguments.indices.contains(index + 1) {
            switch ProcessInfo.processInfo.arguments[index + 1] {
            case "clear": return .clear
            case "tinted": return .clear.tint(.white.opacity(0.15))
            case "regular": return .regular
            default: break
            }
        }
        #endif
        return .clear.tint(Color(red: 0.70, green: 0.91, blue: 1).opacity(0.65))
    }

    var body: some View {
        GeometryReader { proxy in
            let size = proxy.size
            let band = min(size.height * 0.40, size.width * 0.47)
            ZStack {
                LinearGradient(colors: [Color(red: 0.025, green: 0.10, blue: 0.27),
                    Color(red: 0.035, green: 0.25, blue: 0.68)], startPoint: .top, endPoint: .bottom)
                Ellipse()
                    .fill(LinearGradient(colors: [Color(red: 0.04, green: 0.27, blue: 0.65),
                        Color(red: 0.04, green: 0.40, blue: 0.70)], startPoint: .topLeading, endPoint: .bottomTrailing))
                    .frame(width: size.width * 1.7, height: size.height * 0.92)
                    .rotationEffect(.degrees(-22))
                    .position(x: size.width * 0.64, y: size.height * 0.99)
                GlassEffectContainer(spacing: 0) {
                    VStack(spacing: band * 0.035) {
                        numerals(fixtureTime(date, format: "hh"), height: band)
                        numerals(fixtureTime(date, format: "mm"), height: band)
                    }
                }
                .offset(y: size.height * 0.015)
                VStack {
                    HStack {
                        Text(fixtureTime(date, format: "EEE, MMM d").uppercased())
                        Spacer()
                    }
                    Spacer()
                }
                .font(.system(size: max(17, min(size.width, size.height) * 0.026), weight: .semibold))
                .tracking(2).foregroundStyle(Color(red: 0.70, green: 0.91, blue: 1))
                .padding(min(size.width, size.height) * 0.052)
                if night { Color.black.opacity(0.32) }
            }.frame(width: size.width, height: size.height).clipped()
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(fixtureTime(date, format: "h:mm a, EEEE MMMM d"))
    }

    @ViewBuilder private func numerals(_ text: String, height: CGFloat) -> some View {
        if reduceTransparency || contrast == .increased {
            Text(text)
                .font(.system(size: height * 1.38, weight: .bold, design: .rounded))
                .monospacedDigit().tracking(-height * 0.065)
                .foregroundStyle(Color(red: 0.70, green: 0.91, blue: 1))
                .fixedSize().frame(height: height)
        } else {
            TideGlassNumerals(text: text, glass: glass)
                .frame(width: height * 1.65, height: height)
        }
    }
}

/// The system material follows the actual SF Rounded outlines, including counters.
/// A rectangular glass effect behind Text would produce a plaque, not glass digits.
private struct TideGlassNumerals: View {
    let text: String
    let glass: Glass

    var body: some View {
        GeometryReader { proxy in
            let glyphs = TideClockGlyph.layout(text, in: CGRect(origin: .zero, size: proxy.size))
            ZStack(alignment: .topLeading) {
                ForEach(glyphs) { glyph in
                    Color.clear
                        .frame(width: glyph.frame.width, height: glyph.frame.height)
                        .glassEffect(glass, in: glyph.shape)
                        .position(x: glyph.frame.midX, y: glyph.frame.midY)
                }
            }
        }
    }
}

private struct TideClockGlyph: Identifiable {
    // A digit's typographic slot is its identity when its value changes.
    let id: Int
    let frame: CGRect
    let shape: Outline

    struct Outline: Shape {
        let path: Path
        func path(in rect: CGRect) -> Path {
            path.offsetBy(dx: rect.minX, dy: rect.minY)
        }
    }

    @MainActor private static let font: CTFont = {
        #if os(macOS)
        let base = NSFont.monospacedDigitSystemFont(ofSize: 100, weight: .bold)
        let rounded = base.fontDescriptor.withDesign(.rounded).flatMap { NSFont(descriptor: $0, size: 100) }
        #else
        let base = UIFont.monospacedDigitSystemFont(ofSize: 100, weight: .bold)
        let rounded = base.fontDescriptor.withDesign(.rounded).map { UIFont(descriptor: $0, size: 100) }
        #endif
        return CTFontCreateWithName((rounded ?? base).fontName as CFString, 100, nil)
    }()

    @MainActor static func layout(_ text: String, in box: CGRect) -> [Self] {
        let line = CTLineCreateWithAttributedString(NSAttributedString(string: text, attributes: [
            NSAttributedString.Key(kCTFontAttributeName as String): font,
            .kern: -4.5,
        ]))
        var paths: [CGPath] = []
        var bounds = CGRect.null
        for run in CTLineGetGlyphRuns(line) as! [CTRun] {
            let count = CTRunGetGlyphCount(run)
            var glyphs = Array(repeating: CGGlyph(), count: count)
            var positions = Array(repeating: CGPoint.zero, count: count)
            CTRunGetGlyphs(run, CFRange(location: 0, length: 0), &glyphs)
            CTRunGetPositions(run, CFRange(location: 0, length: 0), &positions)
            for (glyph, position) in zip(glyphs, positions) {
                var translation = CGAffineTransform(translationX: position.x, y: position.y)
                guard let path = CTFontCreatePathForGlyph(font, glyph, nil)?.copy(using: &translation) else { continue }
                let outline = path.normalized()
                bounds = bounds.union(outline.boundingBoxOfPath)
                paths.append(outline)
            }
        }
        guard bounds.width > 0, bounds.height > 0 else { return [] }
        let scale = min(box.width / bounds.width, box.height / bounds.height)
        let transform = CGAffineTransform(a: scale, b: 0, c: 0, d: -scale,
            tx: box.midX - bounds.midX * scale, ty: box.midY + bounds.midY * scale)
        return paths.enumerated().map { slot, outline in
            let path = Path(outline).applying(transform)
            let frame = path.boundingRect
            return Self(id: slot, frame: frame, shape: Outline(path: path.offsetBy(dx: -frame.minX, dy: -frame.minY)))
        }
    }
}
