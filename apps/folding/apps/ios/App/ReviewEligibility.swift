import Foundation

/// Local presentation policy, unrelated to ratings, tips or competition scores.
@MainActor struct ReviewEligibility {
  let defaults: UserDefaults

  func claim(setupCompletedAtMS: Int64, activeDays: Int, nowMS: Int64) -> Bool {
    guard nowMS >= setupCompletedAtMS, activeDays >= 3
    else { return false }
    let key = "folding.review.lastAttemptMS"
    if let last = defaults.object(forKey: key) as? NSNumber {
      guard nowMS - last.int64Value >= 30 * 24 * 60 * 60 * 1000 else { return false }
    }
    // Record an attempt, not a claim that StoreKit displayed a prompt or received a rating.
    defaults.set(NSNumber(value: nowMS), forKey: key)
    return true
  }
}
