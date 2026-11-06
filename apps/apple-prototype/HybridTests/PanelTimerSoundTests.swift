import XCTest
import PanelKit
@testable import Panel

@MainActor final class PanelTimerSoundTests: XCTestCase {
    func testTicksPauseCompletionAndReset() {
        let suite = "PanelTimerSoundTests.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        let sound = RecordingTimerSound()
        let timer = PanelTimerStore(defaults: defaults, sound: sound, backgroundAlertsEnabled: false)
        let now = Date(timeIntervalSince1970: 1000)
        timer.setDuration(5)
        XCTAssertFalse(timer.keepsScreenAwake)
        timer.start(at: now)
        XCTAssertTrue(timer.keepsScreenAwake)
        XCTAssertEqual(sound.cues, [.timerTick])
        timer.tick(at: now)
        XCTAssertEqual(sound.cues.count, 1, "No duplicate tick in one second")
        timer.tick(at: now.addingTimeInterval(1))
        XCTAssertEqual(sound.cues.count, 2)
        timer.pause(at: now.addingTimeInterval(2))
        timer.tick(at: now.addingTimeInterval(3))
        XCTAssertEqual(sound.cues.count, 2)
        timer.start(at: now.addingTimeInterval(4))
        timer.tick(at: now.addingTimeInterval(7))
        XCTAssertEqual(timer.countdown.phase, .finished)
        XCTAssertEqual(sound.cues.last, .timerFinished)
        XCTAssertTrue(timer.keepsScreenAwake)
        timer.reset()
        XCTAssertFalse(timer.keepsScreenAwake)
        let count = sound.cues.count
        timer.tick(at: now.addingTimeInterval(12))
        XCTAssertEqual(sound.cues.count, count)
        XCTAssertGreaterThan(sound.stops, 0)
    }
}

@MainActor private final class RecordingTimerSound: PanelSoundPlaying {
    var cues: [PanelSoundCue] = []
    var stops = 0
    func play(_ cue: PanelSoundCue) { cues.append(cue) }
    func stop() { stops += 1 }
}
