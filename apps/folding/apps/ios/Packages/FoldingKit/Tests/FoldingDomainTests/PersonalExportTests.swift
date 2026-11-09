import Foundation
import Testing

@testable import FoldingDomain

private let source = UUID(uuidString: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")!
private func record(_ sequence: Int64, at: Int64, test: Bool = false) -> TrackingEvent {
  TrackingEvent(
    schemaVersion: 1, eventID: UUID(), deviceID: source, sequence: sequence, generation: .initial,
    observedAtMS: at, timezoneID: "UTC", transition: .open, isTest: test, competitionEpochID: nil)
}

@Test func exportPreservesRawFlagsAndNullDurationsWithoutInternalState() throws {
  let first = record(1, at: 1000)
  let test = record(2, at: 2000, test: true)
  let late = record(3, at: 3000)
  let selected = PrivateTransferMarker(
    transferID: UUID(), revision: 1, activeDeviceID: UUID(), sourceWatermarks: [source: 1],
    createdAtMS: 4000)
  let doc = try PersonalExport.document(
    events: [late, first, test], transferMarkers: [selected], generation: .initial,
    homeTimezone: "UTC", exportedAtMS: 5000, uploadStates: [first.eventID: .acknowledged])
  let raw = try #require(
    JSONSerialization.jsonObject(with: PersonalExport.json(doc)) as? [String: Any])
  #expect(
    Set(raw.keys)
      == Set([
        "schema_version", "exported_at_ms", "generation", "home_timezone", "reducer_version",
        "travel_formula", "events", "interruptions", "transfer_markers", "sessions",
        "daily_summaries",
      ]))
  let events = try #require(raw["events"] as? [[String: Any]])
  #expect(events.count == 3)
  #expect(events[0]["event_id"] as? String == first.eventID.uuidString.lowercased())
  #expect(events[0]["included_in_summary"] as? Bool == true)
  #expect(events[0]["public_upload_state"] as? String == "acknowledged")
  #expect(events[1]["is_test"] as? Bool == true)
  #expect(events[1]["included_in_summary"] as? Bool == false)
  #expect(events[2]["excluded_source"] as? Bool == true)
  let sessions = try #require(raw["sessions"] as? [[String: Any]])
  #expect(sessions[0]["end_ms"] is NSNull)
  #expect(sessions[0]["complete_duration_ms"] is NSNull)
  #expect(sessions[0]["completeness"] as? String == "incomplete")
  let summaries = try #require(raw["daily_summaries"] as? [[String: Any]])
  #expect(summaries[0]["folds"] as? Int == 1)
  #expect(summaries[0]["complete_duration_ms"] as? Int == 0)
  #expect(summaries[0]["running_duration_ms"] == nil)
  let formula = try #require(raw["travel_formula"] as? [String: Any])
  #expect(formula["degrees_per_fold"] as? Int == 180)
  #expect(formula["radius_metres"] as? Double == 0.1)
}

@Test func exportRunningSessionStaysUnfinalizedAndCSVEscapesFormulaText() throws {
  let doc = try PersonalExport.document(
    events: [record(1, at: 1000)], generation: .initial, homeTimezone: "UTC", exportedAtMS: 5000)
  #expect(doc.sessions[0].completeness == .running)
  #expect(doc.sessions[0].completeDurationMS == nil)
  #expect(doc.dailySummaries[0].completeDurationMS == 0)
  #expect(PersonalExport.csvCell(" =SUM(A1:A2)") == "\"' =SUM(A1:A2)\"")
  #expect(PersonalExport.csvCell("@command") == "\"'@command\"")
  #expect(PersonalExport.csvCell("\tanything") == "\"'\tanything\"")
  #expect(PersonalExport.csvCell("a,\"b\"\nc") == "\"a,\"\"b\"\"\nc\"")
  #expect(
    PersonalExport.csvFiles(doc).map(\.name) == [
      "events.csv", "sessions.csv", "daily-summaries.csv", "README.txt",
    ])
  let csv = String(decoding: PersonalExport.csvFiles(doc)[1].data, as: UTF8.self)
  #expect(csv.contains("\"1000\",\"\",\"\",\"running\"\r\n"))
}

@Test func privateTransferWireUsesCanonicalObjectKeys() throws {
  let marker = PrivateTransferMarker(
    transferID: UUID(), revision: 3, activeDeviceID: UUID(), sourceWatermarks: [source: 12],
    createdAtMS: 5)
  let data = try JSONEncoder().encode(marker)
  let decoded = try JSONDecoder().decode(PrivateTransferMarker.self, from: data)
  #expect(decoded == marker)
  let raw = try #require(JSONSerialization.jsonObject(with: data) as? [String: Any])
  let watermarks = try #require(raw["source_watermarks"] as? [String: Int])
  #expect(watermarks[source.uuidString.lowercased()] == 12)
}

#if os(macOS)
  @Test func csvArchiveIsReadableByIndependentSystemUnzip() throws {
    let doc = try PersonalExport.document(
      events: [record(1, at: 1000)], generation: .initial, homeTimezone: "UTC", exportedAtMS: 5000)
    let root = FileManager.default.temporaryDirectory.appendingPathComponent(
      "folding-zip-test-\(UUID())")
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: root) }
    let archive = root.appendingPathComponent("export.zip")
    try PersonalExport.csvArchive(doc).write(to: archive)
    let process = Process()
    process.executableURL = URL(fileURLWithPath: "/usr/bin/unzip")
    process.arguments = ["-qq", archive.path, "-d", root.appendingPathComponent("extracted").path]
    try process.run()
    process.waitUntilExit()
    #expect(process.terminationStatus == 0)
    for file in PersonalExport.csvFiles(doc) {
      #expect(
        try Data(
          contentsOf: root.appendingPathComponent("extracted").appendingPathComponent(file.name))
          == file.data)
    }
  }
#endif
