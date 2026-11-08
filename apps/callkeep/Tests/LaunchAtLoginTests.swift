import XCTest
import AppKit
import Carbon
import ServiceManagement

@MainActor
private final class TestLoginService: LoginItemService {
    var status: SMAppService.Status = .notRegistered
    var shouldFail = false
    var registrations = 0
    var removals = 0
    func register() throws {
        if shouldFail { throw CocoaError(.featureUnsupported) }
        registrations += 1; status = .enabled
    }
    func unregister() throws {
        if shouldFail { throw CocoaError(.featureUnsupported) }
        removals += 1; status = .notRegistered
    }
}

final class LaunchAtLoginTests: XCTestCase {
    @MainActor func testToggleUsesSystemStatusAndRefreshesExternalChanges() {
        let service = TestLoginService()
        let login = LaunchAtLogin(service: service, canManage: true)
        XCTAssertFalse(login.enabled)
        login.setEnabled(true)
        XCTAssertTrue(login.enabled)
        XCTAssertEqual(service.registrations, 1)
        login.setEnabled(false)
        XCTAssertFalse(login.enabled)
        XCTAssertEqual(service.removals, 1)
        service.status = .requiresApproval
        login.refresh()
        XCTAssertTrue(login.enabled)
        XCTAssertEqual(login.status, .requiresApproval)
        service.status = .notRegistered
        login.refresh()
        XCTAssertFalse(login.enabled)
    }
    @MainActor func testFailuresKeepActualStatusAndDevBuildsCannotRegister() {
        let service = TestLoginService()
        service.shouldFail = true
        let login = LaunchAtLogin(service: service, canManage: true)
        login.setEnabled(true)
        XCTAssertFalse(login.enabled)
        XCTAssertNotNil(login.error)
        service.shouldFail = false
        login.setEnabled(true)
        XCTAssertTrue(login.enabled)
        XCTAssertNil(login.error)
        let dev = LaunchAtLogin(service: service, canManage: false)
        dev.setEnabled(false)
        XCTAssertEqual(service.removals, 0)
    }
    @MainActor func testBackgroundLaunchEventsAreQuietButManualLaunchesAreNot() {
        let event = NSAppleEventDescriptor(eventClass: AEEventClass(kCoreEventClass), eventID: AEEventID(kAEOpenApplication),
                                           targetDescriptor: nil, returnID: AEReturnID(kAutoGenerateReturnID), transactionID: AETransactionID(kAnyTransactionID))
        XCTAssertFalse(LaunchAtLogin.shouldLaunchQuietly(nil))
        XCTAssertFalse(LaunchAtLogin.shouldLaunchQuietly(event))
        event.setParam(NSAppleEventDescriptor(enumCode: OSType(keyAELaunchedAsServiceItem)), forKeyword: AEKeyword(keyAEPropData))
        XCTAssertTrue(LaunchAtLogin.shouldLaunchQuietly(event))
        event.setParam(NSAppleEventDescriptor(enumCode: OSType(keyAELaunchedAsLogInItem)), forKeyword: AEKeyword(keyAEPropData))
        XCTAssertTrue(LaunchAtLogin.shouldLaunchQuietly(event))
    }
}
