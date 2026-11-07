import Foundation
import Testing

@testable import PanelKit

@Suite struct PanelCountdownTests {
    private let now = Date(timeIntervalSince1970: 1_800_000_000)
    @Test func pausedTimeDoesNotElapseAndResumeUsesExactRemainder() {
        var timer = PanelCountdown(duration: 900)
        timer.start(at: now)
        timer.pause(at: now.addingTimeInterval(123.5))
        #expect(timer.phase == .paused)
        #expect(timer.remaining(at: now.addingTimeInterval(5_000)) == 776.5)
        timer.start(at: now.addingTimeInterval(5_000))
        #expect(timer.remaining(at: now.addingTimeInterval(5_010)) == 766.5)
    }
    @Test func deadlineSurvivesSerializationAndCompletesOnceAfterSuspension() throws {
        var timer = PanelCountdown(duration: 60)
        timer.start(at: now)
        let data = try JSONEncoder().encode(timer)
        var restored = try JSONDecoder().decode(PanelCountdown.self, from: data)
        #expect(restored.remaining(at: now.addingTimeInterval(40)) == 20)
        let completed = restored.finishIfNeeded(at: now.addingTimeInterval(80))
        #expect(completed)
        #expect(restored.phase == .finished)
        #expect(restored.remaining(at: now.addingTimeInterval(90)) == 0)
        let repeated = restored.finishIfNeeded(at: now.addingTimeInterval(100))
        #expect(!repeated)
    }
    @Test func resetAndRestartUseTheChosenDuration() {
        var timer = PanelCountdown(duration: 30)
        timer.start(at: now)
        let changedWhileRunning = timer.setDuration(600)
        #expect(!changedWhileRunning)
        timer.pause(at: now.addingTimeInterval(10))
        let changedWhilePaused = timer.setDuration(600)
        #expect(!changedWhilePaused)
        timer.reset()
        #expect(timer.remaining(at: now) == 30)
        let changedAfterReset = timer.setDuration(600)
        #expect(changedAfterReset)
        timer.start(at: now)
        timer.finishIfNeeded(at: now.addingTimeInterval(700))
        timer.start(at: now.addingTimeInterval(800))
        #expect(timer.remaining(at: now.addingTimeInterval(800)) == 600)
    }
    @Test func pausingAnExpiredTimerFinishesInsteadOfCreatingAZeroSecondPause() {
        var timer = PanelCountdown(duration: 1)
        timer.start(at: now)
        timer.pause(at: now.addingTimeInterval(2))
        #expect(timer.phase == .finished)
        #expect(PanelCountdown(duration: .infinity).duration == 900)
        #expect(PanelCountdown(duration: -10).duration == 1)
    }
}
