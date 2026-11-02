import XCTest
@testable import CallkeepCore

final class AudioPermissionStateTests: XCTestCase {
    func testEitherGrantAllowsSystemAudio() {
        for audioOnly in [Int?.none, 0, 1, 2, 99] {
            XCTAssertEqual(AudioPermissionState.systemAudioAccess(audioOnlyResult: audioOnly, screenCaptureAllowed: true), .allowed)
        }
        XCTAssertEqual(AudioPermissionState.systemAudioAccess(audioOnlyResult: 0, screenCaptureAllowed: false), .allowed)
    }
    func testRevokingBroaderGrantRestoresActualAudioOnlyStatus() {
        XCTAssertEqual(AudioPermissionState.systemAudioAccess(audioOnlyResult: 1, screenCaptureAllowed: true), .allowed)
        XCTAssertEqual(AudioPermissionState.systemAudioAccess(audioOnlyResult: 1, screenCaptureAllowed: false), .denied)
        XCTAssertEqual(AudioPermissionState.systemAudioAccess(audioOnlyResult: 2, screenCaptureAllowed: false), .notDetermined)
        XCTAssertEqual(AudioPermissionState.systemAudioAccess(audioOnlyResult: nil, screenCaptureAllowed: false), .unavailable)
    }
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
