import Foundation
import HealthKit

struct HealthKitWeightChanges: Sendable {
  let added: [WeightEntry]
  let deletedIDs: Set<UUID>
  let anchorData: Data
  let replacesAllHealthKitWeights: Bool
}

@MainActor enum HealthKitWeightStore {
  private static let store = HKHealthStore()
  private static var bodyMass: HKQuantityType? {
    HKQuantityType.quantityType(forIdentifier: .bodyMass)
  }
  private static let anchorKey = "healthKitBodyMassAnchor"

  static func requestAndFetch() async throws -> HealthKitWeightChanges {
    guard HKHealthStore.isHealthDataAvailable(), let bodyMass else {
      throw HealthKitSyncError.healthDataUnavailable
    }
    try await store.requestAuthorization(toShare: [], read: [bodyMass])
    return try await fetch(bodyMass, anchor: nil)
  }

  static func fetchChanges() async throws -> HealthKitWeightChanges {
    guard HKHealthStore.isHealthDataAvailable(), let bodyMass else {
      throw HealthKitSyncError.healthDataUnavailable
    }
    let anchor = UserDefaults.standard.data(forKey: anchorKey).flatMap { data in
      try? NSKeyedUnarchiver.unarchivedObject(ofClass: HKQueryAnchor.self, from: data)
    }
    return try await fetch(bodyMass, anchor: anchor)
  }

  static func saveAnchor(_ data: Data) {
    UserDefaults.standard.set(data, forKey: anchorKey)
  }

  private static func fetch(_ type: HKQuantityType, anchor: HKQueryAnchor?) async throws
    -> HealthKitWeightChanges
  {
    try await withCheckedThrowingContinuation { continuation in
      let query = HKAnchoredObjectQuery(
        type: type,
        predicate: nil,
        anchor: anchor,
        limit: HKObjectQueryNoLimit
      ) { _, samples, deletedObjects, newAnchor, error in
        if let error {
          continuation.resume(throwing: error)
          return
        }
        guard let newAnchor else {
          continuation.resume(throwing: HealthKitSyncError.missingAnchor)
          return
        }
        do {
          let anchorData = try NSKeyedArchiver.archivedData(
            withRootObject: newAnchor, requiringSecureCoding: true)
          let weights = (samples as? [HKQuantitySample] ?? []).map {
            WeightEntry(
              date: $0.startDate,
              kilograms: $0.quantity.doubleValue(for: .gramUnit(with: .kilo)),
              healthKitID: $0.uuid,
              sourceName: $0.sourceRevision.source.name
            )
          }
          continuation.resume(
            returning: HealthKitWeightChanges(
              added: weights,
              deletedIDs: Set((deletedObjects ?? []).map(\.uuid)),
              anchorData: anchorData,
              replacesAllHealthKitWeights: anchor == nil
            ))
        } catch {
          continuation.resume(throwing: error)
        }
      }
      store.execute(query)
    }
  }
}

private enum HealthKitSyncError: LocalizedError {
  case healthDataUnavailable
  case missingAnchor

  var errorDescription: String? {
    switch self {
    case .healthDataUnavailable: "Apple Health data is not available on this device."
    case .missingAnchor: "Apple Health did not return a sync cursor."
    }
  }
}
