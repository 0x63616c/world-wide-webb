import XCTest
@testable import CallkeepCore

final class CallActivityTests: XCTestCase {
    let faceTime = CallingApp.supported[0]
    func testFaceTimeHelpersNeedFaceTimeRunningAndIgnoreDictation() {
        XCTAssertEqual(CallingApp.matching(bundleID: "com.apple.FaceTime"), faceTime)
        XCTAssertNil(CallingApp.matching(bundleID: "com.apple.avconferenced"))
        XCTAssertEqual(CallingApp.matching(bundleID: "com.apple.avconferenced", running: ["com.apple.FaceTime"]), faceTime)
        XCTAssertNil(CallingApp.matching(bundleID: "co.calum.callkeep"))
        XCTAssertNil(CallingApp.matching(bundleID: "com.electron.wispr-flow"))
        XCTAssertEqual(CallingApp.matching(bundleID: "com.google.Chrome.helper")?.name, "Google Chrome")
    }
    func testDebounceDismissalAndNewCall() {
        var filter = CallActivityFilter()
        for now in 0..<5 { XCTAssertNil(filter.update([faceTime], now: Double(now), recording: false)) }
        XCTAssertEqual(filter.update([faceTime], now: 5, recording: false), faceTime)
        XCTAssertNil(filter.update([faceTime], now: 6, recording: false))
        XCTAssertNil(filter.update([], now: 10, recording: false))
        XCTAssertNil(filter.update([faceTime], now: 11, recording: false), "Brief gaps must not repeat a reminder")
        XCTAssertNil(filter.update([], now: 27, recording: false))
        for now in 28..<33 { XCTAssertNil(filter.update([faceTime], now: Double(now), recording: false)) }
        XCTAssertEqual(filter.update([faceTime], now: 33, recording: false), faceTime)
    }
    func testAlreadyRecordingDoesNotPromptWhenRecordingStops() {
        var filter = CallActivityFilter()
        XCTAssertNil(filter.update([faceTime], now: 0, recording: true))
        XCTAssertNil(filter.update([faceTime], now: 6, recording: false))
    }
}
