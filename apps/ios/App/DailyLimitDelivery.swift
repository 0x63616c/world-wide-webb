import FoldingData
import Foundation
import UserNotifications

actor DailyLimitDelivery {
  static let shared = DailyLimitDelivery()
  private let center = UNUserNotificationCenter.current()

  func cancel(_ identifier: String?) {
    guard let identifier else { return }
    center.removePendingNotificationRequests(withIdentifiers: [identifier])
    center.removeDeliveredNotifications(withIdentifiers: [identifier])
  }

  func cancelAll() async {
    let pending = await center.pendingNotificationRequests()
    let delivered = await center.deliveredNotifications()
    center.removePendingNotificationRequests(
      withIdentifiers:
        pending.filter { $0.identifier.hasPrefix("folding.daily-limit.") }.map(\.identifier))
    center.removeDeliveredNotifications(
      withIdentifiers:
        delivered.filter { $0.request.identifier.hasPrefix("folding.daily-limit.") }.map {
          $0.request.identifier
        })
  }

  func deliver(from store: TrackingStore) async {
    do {
      let status = await center.notificationSettings().authorizationStatus
      guard status == .authorized || status == .provisional || status == .ephemeral,
        let lease = try await store.leaseDailyLimitNotification(nowMS: TrackingRuntime.nowMS)
      else { return }
      do {
        let identifier = lease.claim.notificationIdentifier
        let pending = await center.pendingNotificationRequests()
        let delivered = await center.deliveredNotifications()
        try await store.validateDailyLimitNotificationLease(lease, nowMS: TrackingRuntime.nowMS)
        if !pending.contains(where: { $0.identifier == identifier })
          && !delivered.contains(where: { $0.request.identifier == identifier })
        {
          let content = UNMutableNotificationContent()
          content.title = String(
            localized: "notifications.limitReached", defaultValue: "Daily limit reached")
          content.body = String(
            localized: "notifications.limitBody",
            defaultValue: "You’ve reached your fold limit for today.")
          content.sound = .default
          try await center.add(
            UNNotificationRequest(identifier: identifier, content: content, trigger: nil))
          // Reset or account invalidation can race the OS scheduling await.
          do {
            try await store.validateDailyLimitNotificationLease(lease, nowMS: TrackingRuntime.nowMS)
          } catch {
            cancel(identifier)
            throw error
          }
        }
        try await store.acknowledgeDailyLimitNotification(lease)
      } catch {
        try? await store.retryDailyLimitNotification(lease, atMS: TrackingRuntime.nowMS + 30_000)
      }
    } catch {
      // Delivery is best effort; tracking has already committed.
    }
  }
}
