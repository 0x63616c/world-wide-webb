import XCTest
import AppKit

// Hosted CI uses Device Hub's supported controls when simctl has no folding verb.
// The iOS tests independently assert the resulting layout and retained draft/state.
final class DuoHostControlTests: XCTestCase {
    @MainActor func testServePoseRequests() throws {
        continueAfterFailure = false
        let env = ProcessInfo.processInfo.environment
        let directory = URL(fileURLWithPath: try XCTUnwrap(env["DUO_HOST_CONTROL_DIR"]))
        let name = try XCTUnwrap(env["DUO_HOST_DEVICE_NAME"])
        func stage(_ value: String) throws {
            try Data(value.utf8).write(to: directory.appendingPathComponent("host-stage.txt"), options: .atomic)
        }
        try stage("waiting_for_application")
        // Device Hub's trampoline can register a running app with an invalid PID.
        // The owning script starts the real executable and retains its process handle.
        let application = URL(fileURLWithPath: try XCTUnwrap(env["DUO_HOST_APPLICATION_PATH"]))
        let pid = try XCTUnwrap(env["DUO_HOST_APPLICATION_PID"].flatMap(Int32.init))
        XCTAssertGreaterThan(pid, 0)
        let launchDeadline = Date().addingTimeInterval(30)
        while Date() < launchDeadline && NSRunningApplication(processIdentifier: pid)?.isFinishedLaunching != true {
            RunLoop.current.run(until: Date().addingTimeInterval(0.1))
        }
        let running = try XCTUnwrap(NSRunningApplication(processIdentifier: pid))
        XCTAssertEqual(running.processIdentifier, pid)
        XCTAssertEqual(running.bundleURL?.standardizedFileURL, application.standardizedFileURL)
        XCTAssertTrue(running.isFinishedLaunching)
        let hub = XCUIApplication(url: application)
        try stage("activating_application")
        hub.activate()
        XCTAssertTrue(hub.wait(for: .runningForeground, timeout: 15), "The selected Xcode's Device Hub must be running")
        try stage("finding_window")
        try Data(hub.debugDescription.utf8).write(to: directory.appendingPathComponent("host-hierarchy.txt"), options: .atomic)
        let window = hub.windows.firstMatch
        XCTAssertTrue(window.waitForExistence(timeout: 30))
        // A fresh Device Hub can open with no selection. Select the owned device
        // by its full accessible value; never depend on a remembered selection.
        if !window.label.contains(name) {
            try stage("selecting_capture_device")
            let row = window.descendants(matching: .any).matching(
                NSPredicate(format: "value CONTAINS %@ OR label CONTAINS %@", name, name)
            ).firstMatch
            XCTAssertTrue(row.waitForExistence(timeout: 30), "The disposable Duo must be present")
            row.click()
            XCTAssertTrue(window.waitForExistence(timeout: 10))
            let selected = XCTNSPredicateExpectation(
                predicate: NSPredicate(format: "label CONTAINS %@", name), object: window)
            XCTAssertEqual(XCTWaiter.wait(for: [selected], timeout: 10), .completed,
                "Device Hub must select the disposable Duo")
        }
        try Data(hub.debugDescription.utf8).write(to: directory.appendingPathComponent("host-hierarchy.txt"), options: .atomic)
        try stage("finding_pose_controls")
        XCTAssertTrue(window.buttons["Open"].waitForExistence(timeout: 10))
        XCTAssertTrue(window.buttons["Closed"].exists)
        try Data("ready".utf8).write(to: directory.appendingPathComponent("host-ready"), options: .atomic)
        try stage("ready")
        let deadline = Date().addingTimeInterval(90 * 60)
        var previous: String?
        while Date() < deadline && !FileManager.default.fileExists(atPath: directory.appendingPathComponent("host-stop").path) {
            guard let data = try? Data(contentsOf: directory.appendingPathComponent("host-request.json")),
                  let request = try JSONSerialization.jsonObject(with: data) as? [String: String],
                  let id = request["id"], id != previous else {
                Thread.sleep(forTimeInterval: 0.1)
                continue
            }
            previous = id
            hub.activate()
            if let pose = request["pose"] {
                XCTAssertTrue(["inner", "outer"].contains(pose))
                let control = window.buttons[pose == "inner" ? "Open" : "Closed"]
                XCTAssertTrue(control.waitForExistence(timeout: 10))
                control.click()
            } else {
                let orientation = try XCTUnwrap(request["orientation"])
                let title = try XCTUnwrap([
                    "portrait": "Portrait",
                    "landscape-left": "Landscape Left",
                    "landscape-right": "Landscape Right"
                ][orientation])
                // Select an absolute physical orientation. Relative turns depend
                // on the previous pose; XCTest's separate sensor can disagree.
                hub.menuBars.menuBarItems["Device"].click()
                hub.menuItems["Orientation"].hover()
                let control = hub.menuItems[title]
                XCTAssertTrue(control.waitForExistence(timeout: 10))
                XCTAssertTrue(control.isEnabled)
                control.click()
            }
            // Completion is checked by iOS layout assertions after this acknowledgement.
            Thread.sleep(forTimeInterval: 2)
            if let orientation = request["orientation"] {
                let attachment = XCTAttachment(screenshot: window.screenshot())
                attachment.name = "Native orientation \(orientation) \(id)"
                attachment.lifetime = .keepAlways
                add(attachment)
            }
            let response = try JSONSerialization.data(withJSONObject: ["id": id, "ok": true])
            try response.write(to: directory.appendingPathComponent("host-response.json"), options: .atomic)
        }
        XCTAssertTrue(FileManager.default.fileExists(atPath: directory.appendingPathComponent("host-stop").path), "The capture controller must be stopped by its owning job")
    }
}
