import Foundation

/// Scalar lifetime read model; sessions are fetched separately in bounded pages.
public struct PersonalTotals: Codable, Equatable, Sendable {
  public private(set) var opens: Int
  public private(set) var closes: Int
  public private(set) var cycles: Int
  public private(set) var completeDurationMS: Int64
  public private(set) var incompleteSessions: Int
  public var folds: Int { opens + closes }
  public var equivalentDegrees: Double { Double(folds) * 180 }
  public var equivalentMetres: Double { Double(folds) * .pi * 0.1 }
  public init(_ summary: TrackingSummary) {
    opens = summary.opens
    closes = summary.closes
    cycles = summary.cycles
    completeDurationMS = summary.completeDurationMS
    incompleteSessions = summary.incompleteSessions
  }
  public mutating func apply(_ delta: TrackingAppendResult) throws {
    opens += delta.opens
    closes += delta.closes
    cycles += delta.cycles
    let (sum, overflow) = completeDurationMS.addingReportingOverflow(delta.completeDurationMS)
    guard !overflow else { throw TrackingError.invalidEnvelope }
    completeDurationMS = sum
    if delta.finishedSession?.completeness == .incomplete { incompleteSessions += 1 }
  }
}
