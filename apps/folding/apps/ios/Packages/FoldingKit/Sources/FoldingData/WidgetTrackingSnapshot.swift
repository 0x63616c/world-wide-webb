import Foundation

/// A replaceable presentation cache, never an authoritative source of recorded events.
public struct WidgetTrackingSnapshot: Codable, Equatable, Sendable {
  public let schemaVersion: Int
  public let routeID: UUID
  public let generationRevision: Int64
  public let generationID: UUID
  public let generatedAtMS: Int64
  public let homeDayEndMS: Int64
  public let folds: Int
  public let unfoldedMS: Int64
  public let dailyLimit: Int
  public let trend: [Int]
  public let appearance: String
  public let accent: String
  public let setupComplete: Bool

  public init(
    routeID: UUID, generationRevision: Int64, generationID: UUID,
    generatedAtMS: Int64, homeDayEndMS: Int64, folds: Int, unfoldedMS: Int64,
    dailyLimit: Int, trend: [Int], accent: String, setupComplete: Bool,
    appearance: String = "system"
  ) {
    self.schemaVersion = 1
    self.routeID = routeID
    self.generationRevision = generationRevision
    self.generationID = generationID
    self.generatedAtMS = generatedAtMS
    self.homeDayEndMS = homeDayEndMS
    self.folds = folds
    self.unfoldedMS = unfoldedMS
    self.dailyLimit = dailyLimit
    self.trend = trend
    self.appearance = appearance
    self.accent = accent
    self.setupComplete = setupComplete
  }
}

public struct WidgetSnapshotStore: Sendable {
  private let directory: URL

  public init(groupIdentifier: String) throws {
    #if os(iOS)
      guard !groupIdentifier.isEmpty,
        let container = FileManager.default.containerURL(
          forSecurityApplicationGroupIdentifier: groupIdentifier)
      else { throw WidgetSnapshotError.unavailable }
      directory = container.appendingPathComponent("FoldingWidgets", isDirectory: true)
    #else
      throw WidgetSnapshotError.unavailable
    #endif
  }

  public func read() throws -> WidgetTrackingSnapshot {
    let value = try JSONDecoder().decode(
      WidgetTrackingSnapshot.self,
      from: Data(contentsOf: directory.appendingPathComponent("snapshot.json")))
    guard value.schemaVersion == 1, value.folds >= 0, value.unfoldedMS >= 0,
      value.dailyLimit > 0, value.trend.count == 7, value.trend.allSatisfy({ $0 >= 0 }),
      value.generatedAtMS >= 0, value.homeDayEndMS > value.generatedAtMS
    else { throw WidgetSnapshotError.invalid }
    return value
  }

  public func write(_ snapshot: WidgetTrackingSnapshot) throws {
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    let data = try JSONEncoder().encode(snapshot)
    #if os(iOS)
      try data.write(
        to: directory.appendingPathComponent("snapshot.json"),
        options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    #else
      try data.write(to: directory.appendingPathComponent("snapshot.json"), options: .atomic)
    #endif
  }

  public func clear() throws {
    let url = directory.appendingPathComponent("snapshot.json")
    if FileManager.default.fileExists(atPath: url.path) {
      try FileManager.default.removeItem(at: url)
    }
  }
}

public enum WidgetSnapshotError: Error { case unavailable, invalid }
