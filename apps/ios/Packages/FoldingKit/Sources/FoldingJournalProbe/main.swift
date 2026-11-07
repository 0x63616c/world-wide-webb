import FoldingData
import FoldingDomain
import Foundation

// Local test helper only; never linked into the app or widget targets.
@main struct JournalProbe {
  static func main() async throws {
    guard CommandLine.arguments.count == 3, let count = Int(CommandLine.arguments[2]), count > 0,
      count <= 1000
    else {
      throw StoreError.invalidInput
    }
    let store = try TrackingStore(
      directory: URL(fileURLWithPath: CommandLine.arguments[1]),
      installationID: UUID(uuidString: "12345678-1234-4234-8234-123456789abc")!)
    for index in 0..<count {
      let generation = try await store.currentGeneration()
      _ = try await store.record(
        Observation(
          generation: generation,
          transition: index.isMultiple(of: 2) ? .open : .close,
          observedAtMS: Int64(index + 1), timezoneID: "UTC"), nowMS: Int64(index + 1))
    }
  }
}
