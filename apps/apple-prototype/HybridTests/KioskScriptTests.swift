import JavaScriptCore
import XCTest
@testable import Panel

final class KioskScriptTests: XCTestCase {
    private func context(rendered: Bool) throws -> JSContext {
        let context = try XCTUnwrap(JSContext())
        context.evaluateScript("""
        var window = this;
        var messages = [];
        var now = 0;
        Date.now = function() { return now; };
        var callbacks = [];
        function setTimeout(callback, delay) { callbacks.push(callback); }
        window.webkit = { messageHandlers: { panel: { postMessage: function(value) { messages.push(JSON.parse(value)); } } } };
        var document = { getElementById: function(id) { return { childElementCount: \(rendered ? 1 : 0) }; } };
        """)
        context.evaluateScript(KioskScripts.bootstrap)
        return context
    }

    func testBootstrapKeepsDeployedWebBridgeDetection() throws {
        let context = try context(rendered: false)
        XCTAssertTrue(context.evaluateScript("window.__CONTROL_CENTER_EXPO__ === true && typeof window.ReactNativeWebView.postMessage === 'function'")!.toBool())
    }

    func testBootReportsRenderedRootImmediately() throws {
        let context = try context(rendered: true)
        context.evaluateScript(KioskScripts.bootReport)
        XCTAssertNil(context.exception)
        XCTAssertEqual(context.evaluateScript("messages[0].channel")?.toString(), "control-center-shell")
        XCTAssertTrue(context.evaluateScript("messages[0].rendered")!.toBool())
        XCTAssertEqual(context.evaluateScript("callbacks.length")?.toInt32(), 0)
    }

    func testBlankBootReportsFailureAtDeadline() throws {
        let context = try context(rendered: false)
        context.evaluateScript(KioskScripts.bootReport)
        XCTAssertEqual(context.evaluateScript("messages.length")?.toInt32(), 0)
        context.evaluateScript("now = 15000; callbacks.shift()();")
        XCTAssertNil(context.exception)
        XCTAssertFalse(context.evaluateScript("messages[0].rendered")!.toBool())
        XCTAssertEqual(context.evaluateScript("messages.length")?.toInt32(), 1)
    }

    func testBootDetectsRootRenderedAfterDocumentLoad() throws {
        let context = try context(rendered: false)
        context.evaluateScript(KioskScripts.bootReport)
        context.evaluateScript("document.getElementById = function() { return { childElementCount: 1 }; }; callbacks.shift()();")
        XCTAssertTrue(context.evaluateScript("messages[0].rendered")!.toBool())
    }

    func testResponsesAreSuppressedIfThePageNavigatedAway() throws {
        let context = try context(rendered: true)
        context.evaluateScript("""
        // JavaScriptCore has no DOM URL/CustomEvent. Supply the browser surface
        // while exercising the production response script and encoded payload.
        function URL(raw) { this.origin = raw; }
        function CustomEvent(name, options) { this.type = name; this.detail = options.detail; }
        var events = [];
        window.dispatchEvent = function(event) { events.push(event); };
        var serverURL = 'https://board.example';
        window.location = { origin: 'https://external.example' };
        """)
        context.setObject(try NativeResponse.success(id: "request-test").encoded(), forKeyedSubscript: "responseJSON" as NSString)
        context.evaluateScript(KioskScripts.respond)
        XCTAssertNil(context.exception)
        XCTAssertEqual(context.evaluateScript("events.length")?.toInt32(), 0)
        context.evaluateScript("window.location.origin = serverURL;")
        context.evaluateScript(KioskScripts.respond)
        XCTAssertNil(context.exception)
        XCTAssertEqual(context.evaluateScript("events[0].type")?.toString(), "control-center-native-response")
        XCTAssertEqual(context.evaluateScript("events[0].detail.id")?.toString(), "request-test")
        XCTAssertTrue(context.evaluateScript("events[0].detail.ok")!.toBool())
    }
}
