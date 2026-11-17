import CoreGraphics
import Foundation
import ImageIO

/// The splash sprite sheets and their manifest (`Resources/splash.json`), cut into frames once.
/// The sheets and manifest are plain PNG and JSON so other apps and engines can load them too;
/// `Design/generate.py` writes them.
public struct SplashSheets: Sendable {
    public struct Manifest: Decodable, Sendable {
        public struct Point: Decodable, Sendable {
            public let x: Int
            public let y: Int
        }
        public struct Layout: Decodable, Sendable {
            public let width: Int
            public let height: Int
            public let globe: Point
            public let wordmark: Point
            public let bar: Point
        }
        public struct Strip: Decodable, Sendable {
            public let image: String
            public let frameWidth: Int
            public let frameHeight: Int
            public let frames: Int
            public let fps: Int
        }
        public struct Wordmark: Decodable, Sendable {
            public let image: String
            public let width: Int
            public let height: Int
            public let hop: Int
            /// First and last column of each letter.
            public let letters: [[Int]]
        }
        public struct Bars: Decodable, Sendable {
            public let image: String
            public let frameWidth: Int
            public let frameHeight: Int
            public let frames: Int
            public let fps: Int
            public let variants: [Bar]
        }

        public let layout: Layout
        public let globe: Strip
        public let wordmark: Wordmark
        public let bars: Bars
    }

    /// One loading-bar design. `hops[frame]` is the wordmark letter raised in that bar frame, or -1.
    public struct Bar: Decodable, Sendable, Hashable, Identifiable {
        public let id: String
        public let description: String
        public let row: Int
        public let hops: [Int]
    }

    public static let shared = SplashSheets(bundle: .module)

    public let manifest: Manifest
    let globeFrames: [CGImage]
    let letters: [CGImage]
    let barFrames: [String: [CGImage]]

    init(bundle: Bundle) {
        func url(_ name: String) -> URL {
            guard let url = bundle.url(forResource: name, withExtension: nil, subdirectory: "Resources") else {
                preconditionFailure("StudioSplash resource \(name) is missing from the bundle")
            }
            return url
        }
        func image(_ name: String) -> CGImage {
            guard let source = CGImageSourceCreateWithURL(url(name) as CFURL, nil),
                let image = CGImageSourceCreateImageAtIndex(source, 0, nil)
            else { preconditionFailure("StudioSplash could not decode \(name)") }
            return image
        }
        func crop(_ sheet: CGImage, x: Int, y: Int, width: Int, height: Int) -> CGImage {
            guard let frame = sheet.cropping(to: CGRect(x: x, y: y, width: width, height: height)) else {
                preconditionFailure("StudioSplash frame at \(x),\(y) is outside its sheet")
            }
            return frame
        }

        do {
            manifest = try JSONDecoder().decode(Manifest.self, from: Data(contentsOf: url("splash.json")))
        } catch {
            preconditionFailure("StudioSplash manifest is unreadable: \(error)")
        }
        let globe = manifest.globe
        let globeSheet = image(globe.image)
        globeFrames = (0..<globe.frames).map {
            crop(globeSheet, x: $0 * globe.frameWidth, y: 0, width: globe.frameWidth, height: globe.frameHeight)
        }
        let word = manifest.wordmark
        let wordSheet = image(word.image)
        letters = word.letters.map { crop(wordSheet, x: $0[0], y: 0, width: $0[1] - $0[0] + 1, height: word.height) }
        let bars = manifest.bars
        let barSheet = image(bars.image)
        barFrames = Dictionary(
            uniqueKeysWithValues: bars.variants.map { bar in
                (
                    bar.id,
                    (0..<bars.frames).map {
                        crop(
                            barSheet, x: $0 * bars.frameWidth, y: bar.row * bars.frameHeight,
                            width: bars.frameWidth, height: bars.frameHeight)
                    }
                )
            })
    }

    public var bars: [Bar] { manifest.bars.variants }

    /// A loading bar picked at random, so each launch can show a different one.
    public func randomBar() -> Bar {
        guard let bar = bars.randomElement() else { preconditionFailure("StudioSplash has no bars") }
        return bar
    }

    /// Globe and bar frames for a moment, from one clock so the bar and the wordmark wave agree.
    func globeFrame(at seconds: TimeInterval) -> Int {
        Int(seconds * Double(manifest.globe.fps)) % manifest.globe.frames
    }

    func barFrame(at seconds: TimeInterval) -> Int {
        Int(seconds * Double(manifest.bars.fps)) % manifest.bars.frames
    }
}
