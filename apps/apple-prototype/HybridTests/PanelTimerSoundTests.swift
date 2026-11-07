import XCTest
import PanelKit
@testable import Panel

@MainActor final class PanelTimerSoundTests: XCTestCase {
    func testOnlyCompletionRingsAndStopSilencesIt() {
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
        XCTAssertTrue(sound.cues.isEmpty)
        timer.tick(at: now.addingTimeInterval(1))
        XCTAssertTrue(sound.cues.isEmpty)
        timer.pause(at: now.addingTimeInterval(2))
        XCTAssertFalse(timer.keepsScreenAwake)
        timer.tick(at: now.addingTimeInterval(3))
        XCTAssertTrue(sound.cues.isEmpty)
        timer.start(at: now.addingTimeInterval(4))
        XCTAssertTrue(timer.keepsScreenAwake)
        timer.tick(at: now.addingTimeInterval(7))
        XCTAssertEqual(timer.countdown.phase, .finished)
        XCTAssertEqual(sound.cues, [.timerFinished])
        timer.tick(at: now.addingTimeInterval(8))
        XCTAssertEqual(sound.cues, [.timerFinished])
        timer.tick(at: now.addingTimeInterval(10))
        XCTAssertEqual(sound.cues, [.timerFinished, .timerFinished])
        XCTAssertFalse(timer.keepsScreenAwake)
        let restored = PanelTimerStore(defaults: defaults, sound: sound, backgroundAlertsEnabled: false)
        XCTAssertEqual(restored.countdown.phase, .finished)
        XCTAssertFalse(restored.keepsScreenAwake, "A finished timer restored after launch must not disable idle return and dimming")
        let stops = sound.stops
        timer.reset()
        XCTAssertFalse(timer.keepsScreenAwake)
        let count = sound.cues.count
        timer.tick(at: now.addingTimeInterval(12))
        XCTAssertEqual(sound.cues.count, count)
        XCTAssertEqual(sound.stops, stops + 1)
    }
}

@MainActor private final class RecordingTimerSound: PanelSoundPlaying {
    var cues: [PanelSoundCue] = []
    var stops = 0
    func play(_ cue: PanelSoundCue) { cues.append(cue) }
    func stop() { stops += 1 }
}
