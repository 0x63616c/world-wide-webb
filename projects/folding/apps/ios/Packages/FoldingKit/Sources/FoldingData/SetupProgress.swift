import FoldingDomain
import Foundation

public enum SetupStep: String, Codable, Sendable {
  case welcome, openingInstructions, openingReady, awaitingOpening, openingPassed, openingRetry
  case closingInstructions, closingReady, awaitingClosing, closingPassed, closingRetry, complete

  public var isWaiting: Bool { self == .awaitingOpening || self == .awaitingClosing }
}

public enum SetupAction: Sendable { case next, test, retry, dismiss, restart }

public struct SetupCompletion: Codable, Equatable, Sendable {
  public let flowID: UUID
  public let deviceID: UUID
  public let generation: ResetGeneration
  public let openingEventID: UUID
  public let closingEventID: UUID
  public let completedAtMS: Int64
}

public struct SetupProgress: Codable, Equatable, Sendable {
  public internal(set) var schemaVersion = 1
  public internal(set) var flowID: UUID
  public internal(set) var deviceID: UUID
  public internal(set) var generation: ResetGeneration
  public internal(set) var step: SetupStep = .welcome
  public internal(set) var attemptID: UUID?
  public internal(set) var expiresAtMS: Int64?
  public internal(set) var openingEventID: UUID?
  public internal(set) var closingEventID: UUID?
  public internal(set) var lastCompletion: SetupCompletion?

  init(deviceID: UUID, generation: ResetGeneration, lastCompletion: SetupCompletion? = nil) {
    self.flowID = UUID()
    self.deviceID = deviceID
    self.generation = generation
    self.lastCompletion = lastCompletion
  }
}
