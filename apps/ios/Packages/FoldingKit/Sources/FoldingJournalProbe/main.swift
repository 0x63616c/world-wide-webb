import FoldingData
import FoldingDomain
import Foundation

// Local test helper only; never linked into the app or widget targets.
@main struct JournalProbe {
  static func main() async throws {
    if CommandLine.arguments.count == 3, CommandLine.arguments[1] == "--partition-fence" {
      let root = URL(fileURLWithPath: CommandLine.arguments[2])
      let router = AccountPartitionRouter(directory: root)
      guard
        let lease = try router.currentLease(
          installationID: UUID(uuidString: "12345678-1234-4234-8234-123456789abc")!)
      else { throw PartitionError.inactive }
      let store = try router.openJournal(
        lease: lease, installationID: UUID(uuidString: "12345678-1234-4234-8234-123456789abc")!)
      try Data().write(to: root.appendingPathComponent("probe-ready"))
      let deadline = ContinuousClock.now + .seconds(5)
      while !FileManager.default.fileExists(
        atPath: root.appendingPathComponent("probe-resume").path)
      {
        guard ContinuousClock.now < deadline else { throw PartitionError.busy }
        try await Task.sleep(for: .milliseconds(10))
      }
      do {
        _ = try await store.summary()
      } catch PartitionError.inactive { return }
      throw StoreError.invalidInput
    }
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
