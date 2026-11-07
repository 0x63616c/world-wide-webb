import FoldingDomain
import Foundation

/// Writes ZIP stored entries with data descriptors so no CSV file or entire archive is buffered.
enum StreamingCSVArchive {
  static func write(_ document: PersonalExportDocument, to handle: FileHandle) throws {
    var central = Data()
    var position: UInt64 = 0
    func emit(_ bytes: Data) throws {
      try Task.checkCancellation()
      try handle.write(contentsOf: bytes)
      position += UInt64(bytes.count)
    }
    func entry(_ name: String, body: (_ line: (String) throws -> Void) throws -> Void) throws {
      let filename = Data(name.utf8)
      guard let offset = UInt32(exactly: position), let nameLength = UInt16(exactly: filename.count)
      else { throw AnalyticsError.resultTooLarge }
      var header = Data()
      header.appendExportLE(UInt32(0x0403_4b50))
      for value: UInt16 in [20, 0x0808, 0, 0, 33] { header.appendExportLE(value) }
      for _ in 0..<3 { header.appendExportLE(UInt32(0)) }
      header.appendExportLE(nameLength)
      header.appendExportLE(UInt16(0))
      header.append(filename)
      try emit(header)
      let start = position
      var crc = UInt32.max
      try body { value in
        let bytes = Data(value.utf8)
        for byte in bytes {
          crc ^= UInt32(byte)
          for _ in 0..<8 { crc = (crc >> 1) ^ ((crc & 1) == 1 ? 0xedb8_8320 : 0) }
        }
        try emit(bytes)
      }
      crc ^= UInt32.max
      guard let size = UInt32(exactly: position - start) else {
        throw AnalyticsError.resultTooLarge
      }
      var descriptor = Data()
      for value in [UInt32(0x0807_4b50), crc, size, size] { descriptor.appendExportLE(value) }
      try emit(descriptor)
      central.appendExportLE(UInt32(0x0201_4b50))
      for value: UInt16 in [20, 20, 0x0808, 0, 0, 33] { central.appendExportLE(value) }
      for value in [crc, size, size] { central.appendExportLE(value) }
      central.appendExportLE(nameLength)
      for _ in 0..<4 { central.appendExportLE(UInt16(0)) }
      central.appendExportLE(UInt32(0))
      central.appendExportLE(offset)
      central.append(filename)
    }
    func row(_ values: [String]) -> String {
      values.map(PersonalExport.csvCell).joined(separator: ",") + "\r\n"
    }
    try entry("events.csv") { line in
      try line(
        row([
          "event_id", "device_id", "sequence", "generation_revision", "generation_id",
          "observed_at_ms", "timezone_id", "transition", "is_test", "included_in_summary",
          "public_upload_state",
        ]))
      for value in document.events {
        let event = value.event
        try line(
          row([
            event.eventID.uuidString.lowercased(), event.deviceID.uuidString.lowercased(),
            String(event.sequence), String(event.generation.revision),
            event.generation.resetID.uuidString.lowercased(), String(event.observedAtMS),
            event.timezoneID, event.transition.rawValue, String(event.isTest),
            String(value.includedInSummary), value.publicUploadState.rawValue,
          ]))
      }
    }
    try entry("sessions.csv") { line in
      try line(row(["device_id", "start_ms", "end_ms", "complete_duration_ms", "completeness"]))
      for value in document.sessions {
        try line(
          row([
            value.deviceID.uuidString.lowercased(), String(value.startMS),
            value.endMS.map(String.init) ?? "", value.completeDurationMS.map(String.init) ?? "",
            value.completeness.rawValue,
          ]))
      }
    }
    try entry("daily-summaries.csv") { line in
      try line(
        row([
          "date", "timezone_id", "folds", "opens", "closes", "cycles", "complete_duration_ms",
          "equivalent_degrees", "equivalent_metres",
        ]))
      for value in document.dailySummaries {
        try line(
          row([
            value.date, value.timezoneID, String(value.folds), String(value.opens),
            String(value.closes), String(value.cycles), String(value.completeDurationMS),
            String(value.equivalentDegrees), String(value.equivalentMetres),
          ]))
      }
    }
    try entry("README.txt") { line in
      try line(
        """
        Folding export schema 1; reducer \(TrackingReducer.version).
        Home timezone: \(document.homeTimezone). Timestamps are integer UTC milliseconds.
        Equivalent travel formula v1: 180 degrees and pi * 0.1 metres per fold; not measured motion.
        Finalized duration includes complete/candidate sessions; running/incomplete duration is blank.
        CSV is UTF-8/RFC4180. Formula-leading strings are prefixed with an apostrophe; JSON preserves raw values.
        Test and excluded-source events are retained but excluded from summaries. A repeated-state observation may be eligible yet add no fold.
        """)
    }
    guard let centralOffset = UInt32(exactly: position),
      let centralSize = UInt32(exactly: central.count)
    else { throw AnalyticsError.resultTooLarge }
    try emit(central)
    var end = Data()
    end.appendExportLE(UInt32(0x0605_4b50))
    for value: UInt16 in [0, 0, 4, 4] { end.appendExportLE(value) }
    end.appendExportLE(centralSize)
    end.appendExportLE(centralOffset)
    end.appendExportLE(UInt16(0))
    try emit(end)
  }
}

extension Data {
  fileprivate mutating func appendExportLE<T: FixedWidthInteger>(_ value: T) {
    var value = value.littleEndian
    Swift.withUnsafeBytes(of: &value) { append(contentsOf: $0) }
  }
}
