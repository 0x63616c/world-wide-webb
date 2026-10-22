import XCTest
@testable import CallkeepCore

final class AudioPermissionStateTests: XCTestCase {
    func testLiveResultsReflectGrantAndRevocation() {
        XCTAssertEqual(AudioPermissionState.preflightResult(0), .allowed)
        XCTAssertEqual(AudioPermissionState.preflightResult(1), .denied)
        XCTAssertEqual(AudioPermissionState.preflightResult(2), .notDetermined)
    }
    func testUnavailableOrChangedAPIIsNeverPresentedAsAllowed() {
        XCTAssertEqual(AudioPermissionState.preflightResult(nil), .unavailable)
        XCTAssertEqual(AudioPermissionState.preflightResult(-1), .unavailable)
        XCTAssertEqual(AudioPermissionState.preflightResult(99), .unavailable)
    }
}
