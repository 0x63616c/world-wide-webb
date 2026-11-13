import XCTest

@testable import CallkeepCore

final class CallActivityTests: XCTestCase {
  let faceTime = CallingApp.supported[0]
  let phone = CallingApp.supported[1]
  func testFaceTimeHelpersNeedFaceTimeRunningAndIgnoreDictation() {
    XCTAssertEqual(CallingApp.matching(bundleID: "com.apple.FaceTime"), faceTime)
    XCTAssertNil(CallingApp.matching(bundleID: "com.apple.avconferenced"))
    XCTAssertEqual(
      CallingApp.matching(bundleID: "com.apple.avconferenced", running: ["com.apple.FaceTime"]),
      faceTime)
    XCTAssertEqual(CallingApp.matching(bundleID: "com.apple.mobilephone"), phone)
    XCTAssertEqual(CallingApp.matching(bundleID: "com.apple.mobilephone.helper"), phone)
    XCTAssertEqual(
      CallingApp.matching(bundleID: "com.apple.avconferenced", running: ["com.apple.mobilephone"]),
      phone)
    XCTAssertEqual(
      CallingApp.matching(
        bundleID: "com.apple.avconferenced",
        running: ["com.apple.mobilephone", "com.apple.FaceTime"])?.name, "Phone or FaceTime")
    XCTAssertEqual(
      CallingApp.matching(
        bundleID: "", executablePath: "/usr/libexec/avconferenced",
        running: ["com.apple.mobilephone"]), phone)
    XCTAssertNil(CallingApp.matching(bundleID: "co.calum.callkeep"))
    XCTAssertNil(CallingApp.matching(bundleID: "com.electron.wispr-flow"))
    XCTAssertEqual(CallingApp.matching(bundleID: "com.google.Chrome.helper")?.name, "Google Chrome")
  }
  func testDebounceDismissalAndNewCall() {
    var filter = CallActivityFilter()
    XCTAssertNil(filter.update([faceTime], now: 0, recording: false))
    XCTAssertNil(filter.update([faceTime], now: 0.49, recording: false))
    XCTAssertEqual(filter.update([faceTime], now: 0.5, recording: false), faceTime)
    XCTAssertNil(filter.update([faceTime], now: 6, recording: false))
    XCTAssertNil(filter.update([], now: 10, recording: false))
    XCTAssertNil(
      filter.update([faceTime], now: 11, recording: false), "Brief gaps must not repeat a reminder")
    XCTAssertNil(filter.update([], now: 27, recording: false))
    XCTAssertNil(filter.update([faceTime], now: 28, recording: false))
    XCTAssertEqual(filter.update([faceTime], now: 28.5, recording: false), faceTime)
  }
  func testAlreadyRecordingDoesNotPromptWhenRecordingStops() {
    var filter = CallActivityFilter()
    XCTAssertNil(filter.update([faceTime], now: 0, recording: true))
    XCTAssertNil(filter.update([faceTime], now: 6, recording: false))
  }
  func testConfiguredReminderDelay() {
    var filter = CallActivityFilter()
    XCTAssertNil(filter.update([faceTime], now: 0, recording: false, delay: 2))
    XCTAssertNil(filter.update([faceTime], now: 1.5, recording: false, delay: 2))
    XCTAssertEqual(filter.update([faceTime], now: 2, recording: false, delay: 2), faceTime)
  }
  func testNextReminderDeadlineTracksActiveApps() {
    var filter = CallActivityFilter()
    XCTAssertNil(filter.nextReminderDelay(for: [phone], now: 10, delay: 0.5))
    XCTAssertNil(filter.update([phone], now: 10, recording: false))
    XCTAssertEqual(
      filter.nextReminderDelay(for: [phone], now: 10.2, delay: 0.5)!, 0.3, accuracy: 0.0001)
    XCTAssertNil(filter.nextReminderDelay(for: [], now: 10.2, delay: 0.5))
    XCTAssertEqual(filter.update([phone], now: 10.5, recording: false), phone)
    XCTAssertNil(filter.nextReminderDelay(for: [phone], now: 10.5, delay: 0.5))
  }
  func testDeadlineUsesEarliestActiveAppAndConfiguredDelay() {
    var filter = CallActivityFilter()
    XCTAssertNil(filter.update([faceTime], now: 0, recording: false, delay: 2))
    XCTAssertNil(filter.update([faceTime, phone], now: 0.5, recording: false, delay: 2))
    XCTAssertEqual(
      filter.nextReminderDelay(for: [faceTime, phone], now: 0.5, delay: 2)!, 1.5, accuracy: 0.0001)
    XCTAssertEqual(filter.nextReminderDelay(for: [phone], now: 0.5, delay: 2)!, 2, accuracy: 0.0001)
    XCTAssertEqual(
      filter.nextReminderDelay(for: [faceTime], now: 0.5, delay: 1)!, 0.5, accuracy: 0.0001)
    XCTAssertEqual(filter.update([faceTime, phone], now: 2, recording: false, delay: 2), faceTime)
    XCTAssertEqual(
      filter.nextReminderDelay(for: [faceTime, phone], now: 2, delay: 2)!, 0.5, accuracy: 0.0001)
  }
}
