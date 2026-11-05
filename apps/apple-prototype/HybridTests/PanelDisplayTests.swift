import XCTest
@testable import Panel

@MainActor final class PanelDisplayTests: XCTestCase {
    func testWakeRestoresFullBrightnessRatherThanPreviouslyDimSystemValue() {
        var screen = CGFloat(0.3)
        let lease = PanelBrightnessLease()
        lease.acquire(read: { screen }, write: { screen = $0 })
        lease.apply(1)
        XCTAssertEqual(screen, 1)
        lease.apply(0.3)
        XCTAssertEqual(screen, 0.3, accuracy: 0.001)
        lease.apply(1)
        XCTAssertEqual(screen, 1)
        lease.restore()
        XCTAssertEqual(screen, 0.3, accuracy: 0.001, "Leaving Panel restores the original system setting")
    }

    func testRepeatedAttachmentDoesNotCaptureDimmedValueAsOriginal() {
        var screen = CGFloat(0.7)
        let lease = PanelBrightnessLease()
        lease.acquire(read: { screen }, write: { screen = $0 })
        lease.apply(0.3)
        lease.acquire(read: { screen }, write: { screen = $0 })
        lease.restore()
        XCTAssertEqual(screen, 0.7, accuracy: 0.001)
        screen = 0.5
        lease.restore()
        XCTAssertEqual(screen, 0.5, "Restoration is idempotent")
        lease.acquire(read: { screen }, write: { screen = $0 })
        lease.apply(1)
        XCTAssertEqual(screen, 1)
        lease.restore()
        XCTAssertEqual(screen, 0.5)
    }

    func testDisplayTimeoutStillDimsAfterEarlierReturnToClock() {
        let state = PanelIdleState(now: 0)
        XCTAssertFalse(state.tick(now: 59, dimAfter: 120, returnAfter: 60, dimEnabled: true))
        XCTAssertTrue(state.tick(now: 60, dimAfter: 120, returnAfter: 60, dimEnabled: true))
        XCTAssertFalse(state.dimmed)
        XCTAssertFalse(state.tick(now: 120, dimAfter: 120, returnAfter: 60, dimEnabled: true))
        XCTAssertTrue(state.dimmed)
        state.activity(now: 121)
        XCTAssertTrue(state.dimmed, "Observing a touch must not forward the wake touch into controls")
        state.wake(now: 121)
        XCTAssertFalse(state.dimmed)
        XCTAssertFalse(state.tick(now: 150, dimAfter: 120, returnAfter: 60, dimEnabled: true))
    }

    func testGlobalDimmingWorksEvenWhenAppNeverReturnsToClock() {
        let state = PanelIdleState(now: 0)
        state.activity(now: 20)
        XCTAssertFalse(state.tick(now: 30, dimAfter: 30, returnAfter: 0, dimEnabled: true))
        XCTAssertFalse(state.tick(now: 50, dimAfter: 30, returnAfter: 0, dimEnabled: true))
        XCTAssertTrue(state.dimmed)
        state.wake(now: 60)
        XCTAssertFalse(state.tick(now: 1000, dimAfter: 30, returnAfter: 0, dimEnabled: false))
        XCTAssertFalse(state.dimmed)
    }
    func testActiveSessionInhibitsBothDeadlinesAndRestartsIdleAfterward() {
        let state = PanelIdleState(now: 0)
        XCTAssertFalse(state.tick(now: 1000, dimAfter: 30, returnAfter: 60, dimEnabled: true, inhibited: true))
        XCTAssertFalse(state.dimmed)
        XCTAssertFalse(state.tick(now: 1029, dimAfter: 30, returnAfter: 60, dimEnabled: true))
        XCTAssertFalse(state.dimmed)
        XCTAssertTrue(state.tick(now: 1060, dimAfter: 30, returnAfter: 60, dimEnabled: true))
        XCTAssertTrue(state.dimmed)
        XCTAssertFalse(state.tick(now: 1061, dimAfter: 30, returnAfter: 60, dimEnabled: true, inhibited: true))
        XCTAssertFalse(state.dimmed)
    }

}
