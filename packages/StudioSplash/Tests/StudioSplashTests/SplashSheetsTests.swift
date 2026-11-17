import Testing

@testable import StudioSplash

struct SplashSheetsTests {
    let sheets = SplashSheets.shared

    @Test func everyFrameIsCutAtTheManifestSize() {
        let manifest = sheets.manifest
        #expect(sheets.globeFrames.count == manifest.globe.frames)
        #expect(sheets.globeFrames.allSatisfy { $0.width == 41 && $0.height == 41 })
        #expect(sheets.letters.count == "WORLDWIDEWEBB".count)
        for bar in sheets.bars {
            let frames = sheets.barFrames[bar.id] ?? []
            #expect(frames.count == manifest.bars.frames, "\(bar.id)")
            let bars = manifest.bars
            #expect(frames.allSatisfy { $0.width == bars.frameWidth && $0.height == bars.frameHeight })
            #expect(bar.hops.count == manifest.bars.frames, "\(bar.id)")
            #expect(bar.hops.allSatisfy { (-1..<sheets.letters.count).contains($0) }, "\(bar.id)")
        }
    }

    @Test func barsMatchTheWordmarkWidthAndTheLayoutSpacing() {
        let manifest = sheets.manifest
        let layout = manifest.layout
        #expect(manifest.bars.frameWidth == manifest.wordmark.width)
        #expect(layout.width == manifest.wordmark.width)
        // The globe's visible rows are 1...39 of its 41-row frame: 4 px to the wordmark, 4 px to the bar.
        #expect(layout.globe.y + 39 + 1 + 4 == layout.wordmark.y)
        #expect(layout.wordmark.y + manifest.wordmark.height + 4 == layout.bar.y)
        #expect(layout.bar.y + manifest.bars.frameHeight == layout.height)
    }

    @Test func everyBarWavesEachLetterOnceInOrder() {
        for bar in sheets.bars {
            var order: [Int] = []
            for letter in bar.hops where letter >= 0 && order.last != letter { order.append(letter) }
            #expect(order == Array(0..<sheets.letters.count), "\(bar.id)")
        }
    }

    @Test func framesFollowTheSharedClock() {
        #expect(sheets.globeFrame(at: 0) == 0)
        #expect(sheets.globeFrame(at: 0.125) == 1)
        #expect(sheets.globeFrame(at: 1.0) == 0)
        #expect(sheets.barFrame(at: 0.02) == 1)
        #expect(sheets.barFrame(at: 2.0) == 0)
    }
}
