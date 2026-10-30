import JavaScriptCore
import XCTest
@testable import Panel

final class NativeAlarmBridgeTests: XCTestCase {
    private func context(_ setup: String) throws -> JSContext {
        let context = try XCTUnwrap(JSContext())
        context.evaluateScript("""
        var window = this;
        function URL(value) { this.origin = value; }
        var serverURL = "https://panel.example.invalid";
        var native = true;
        var callbacks = [];
        function setTimeout(callback, delay) { callbacks.push(callback); }
        window.location = { origin: serverURL };
        var acknowledged = null;
        \(setup)
        (async function () { \(KioskScripts.alarmOwnership) })().then(value => { acknowledged = value; });
        """)
        XCTAssertNil(context.exception)
        return context
    }

    func testOldWebRuntimeCannotAcknowledgeNativeOwnership() throws {
        let context = try context("")
        XCTAssertTrue(context.evaluateScript("acknowledged === false")!.toBool())
    }

    func testTrustedRuntimeAcknowledgesAndUntrustedRuntimeIsNotCalled() throws {
        let accepted = try context("window.__CONTROL_CENTER_SET_ALARM_OWNER__ = async value => value;")
        XCTAssertTrue(accepted.evaluateScript("acknowledged === true")!.toBool())
        let rejected = try context("""
        var called = false;
        window.location.origin = "https://external.example.invalid";
        window.__CONTROL_CENTER_SET_ALARM_OWNER__ = async value => { called = true; return true; };
        """)
        XCTAssertTrue(rejected.evaluateScript("acknowledged === false && called === false")!.toBool())
    }

    func testUnresponsiveRuntimeTimesOutWithoutEnablingNativeRinging() throws {
        let context = try context("window.__CONTROL_CENTER_SET_ALARM_OWNER__ = value => new Promise(() => {});")
        XCTAssertTrue(context.evaluateScript("acknowledged === null")!.toBool())
        context.evaluateScript("callbacks.forEach(callback => callback());")
        XCTAssertTrue(context.evaluateScript("acknowledged === false")!.toBool())
    }
}
