import SwiftUI

/// The studio splash: spinning globe, WORLD WIDE WEBB wordmark and a loading bar, drawn at a whole
/// number of points per art pixel. The parts are also public views, so an app can lay them out
/// itself; parts showing the same bar stay in step because they share `SplashClock`.
public struct StudioSplash: View {
    private let pixel: CGFloat
    // State, so the bar picked when the splash appears survives the parent redrawing it.
    @State private var bar: SplashSheets.Bar

    /// - Parameters:
    ///   - pixel: Points per art pixel. Keep it a whole number so every pixel stays square.
    ///   - bar: The loading bar; a random one when nil.
    public init(pixel: CGFloat, bar: SplashSheets.Bar? = nil) {
        self.pixel = pixel
        _bar = State(initialValue: bar ?? SplashSheets.shared.randomBar())
    }

    public var body: some View {
        let layout = SplashSheets.shared.manifest.layout
        ZStack(alignment: .topLeading) {
            SplashGlobe(pixel: pixel)
                .offset(x: CGFloat(layout.globe.x) * pixel, y: CGFloat(layout.globe.y) * pixel)
            SplashWordmark(pixel: pixel, bar: bar)
                .offset(x: CGFloat(layout.wordmark.x) * pixel, y: CGFloat(layout.wordmark.y) * pixel)
            SplashBar(pixel: pixel, bar: bar)
                .offset(x: CGFloat(layout.bar.x) * pixel, y: CGFloat(layout.bar.y) * pixel)
        }
        .frame(width: CGFloat(layout.width) * pixel, height: CGFloat(layout.height) * pixel, alignment: .topLeading)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("World Wide Webb, loading")
    }
}

/// The time every splash part reads, so a bar and its wordmark wave share frames.
public enum SplashClock {
    public static let start = Date()

    static func seconds(at date: Date) -> TimeInterval { max(0, date.timeIntervalSince(start)) }
}

/// The 8-frame globe, turning at 8 fps. Reduce Motion holds the first frame.
public struct SplashGlobe: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    private let pixel: CGFloat

    public init(pixel: CGFloat) { self.pixel = pixel }

    public var body: some View {
        let sheets = SplashSheets.shared
        let strip = sheets.manifest.globe
        TimelineView(.periodic(from: SplashClock.start, by: 1.0 / Double(strip.fps))) { context in
            let frame = reduceMotion ? 0 : sheets.globeFrame(at: SplashClock.seconds(at: context.date))
            Image(decorative: sheets.globeFrames[frame], scale: 1)
                .interpolation(.none)
                .resizable()
                .frame(width: CGFloat(strip.frameWidth) * pixel, height: CGFloat(strip.frameHeight) * pixel)
        }
        .accessibilityHidden(true)
    }
}

/// WORLD WIDE WEBB, with each letter hopping 1 px when `bar` says so. Reduce Motion keeps it still.
public struct SplashWordmark: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    private let pixel: CGFloat
    private let bar: SplashSheets.Bar

    public init(pixel: CGFloat, bar: SplashSheets.Bar) {
        self.pixel = pixel
        self.bar = bar
    }

    public var body: some View {
        let sheets = SplashSheets.shared
        let word = sheets.manifest.wordmark
        TimelineView(.periodic(from: SplashClock.start, by: 1.0 / Double(sheets.manifest.bars.fps))) { context in
            let raised = reduceMotion ? -1 : bar.hops[sheets.barFrame(at: SplashClock.seconds(at: context.date))]
            ZStack(alignment: .topLeading) {
                ForEach(Array(sheets.letters.enumerated()), id: \.offset) { index, letter in
                    Image(decorative: letter, scale: 1)
                        .interpolation(.none)
                        .resizable()
                        .frame(width: CGFloat(letter.width) * pixel, height: CGFloat(letter.height) * pixel)
                        .offset(
                            x: CGFloat(word.letters[index][0]) * pixel,
                            y: index == raised ? -CGFloat(word.hop) * pixel : 0)
                }
            }
            .frame(width: CGFloat(word.width) * pixel, height: CGFloat(word.height) * pixel, alignment: .topLeading)
        }
        .accessibilityHidden(true)
    }
}

/// One loading-bar design from the bar sheet, at 50 fps.
public struct SplashBar: View {
    private let pixel: CGFloat
    private let bar: SplashSheets.Bar

    public init(pixel: CGFloat, bar: SplashSheets.Bar) {
        self.pixel = pixel
        self.bar = bar
    }

    public var body: some View {
        let sheets = SplashSheets.shared
        let bars = sheets.manifest.bars
        TimelineView(.periodic(from: SplashClock.start, by: 1.0 / Double(bars.fps))) { context in
            let frames = sheets.barFrames[bar.id] ?? []
            if !frames.isEmpty {
                Image(decorative: frames[sheets.barFrame(at: SplashClock.seconds(at: context.date))], scale: 1)
                    .interpolation(.none)
                    .resizable()
                    .frame(width: CGFloat(bars.frameWidth) * pixel, height: CGFloat(bars.frameHeight) * pixel)
            }
        }
        .accessibilityHidden(true)
    }
}
