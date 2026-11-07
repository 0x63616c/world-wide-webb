import UIKit
import UserNotifications

struct PushNotificationRoute: Sendable {
  let periodID: String
  let period: CompetitionPeriod

  static func parse(_ userInfo: [AnyHashable: Any]) -> Self? {
    guard let payload = userInfo["folding"] as? [String: Any],
      let kind = payload["kind"] as? String,
      let id = payload["period_id"] as? String, !id.isEmpty, id.utf8.count <= 256,
      !id.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) })
    else { return nil }
    let period: CompetitionPeriod
    switch kind {
    case "weekly_result": period = .week
    case "monthly_result": period = .month
    default: return nil
    }
    return Self(periodID: id, period: period)
  }
}

@MainActor
final class FoldingPushAppDelegate: NSObject, UIApplicationDelegate,
  UNUserNotificationCenterDelegate
{
  var registration: PushRegistration?
  var localDailyLimitEnabled = false
  /// Return false while authentication/membership is unavailable; the route remains queued.
  var openResults: ((String, CompetitionPeriod) -> Bool)? {
    didSet { deliverPendingRoute() }
  }
  private var pendingRoute: PushNotificationRoute?

  func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    UNUserNotificationCenter.current().delegate = self
    return true
  }

  func application(
    _ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
  ) {
    Task { await registration?.received(token: deviceToken) }
  }

  func application(
    _ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error
  ) {
    registration?.registrationFailed(error)
  }

  nonisolated func userNotificationCenter(
    _ center: UNUserNotificationCenter,
    willPresent notification: UNNotification
  ) async -> UNNotificationPresentationOptions {
    let route = PushNotificationRoute.parse(notification.request.content.userInfo)
    let identifier = notification.request.identifier
    return await foregroundOptions(route: route, identifier: identifier)
  }

  nonisolated func userNotificationCenter(
    _ center: UNUserNotificationCenter,
    didReceive response: UNNotificationResponse
  ) async {
    guard response.actionIdentifier == UNNotificationDefaultActionIdentifier,
      let route = PushNotificationRoute.parse(response.notification.request.content.userInfo)
    else { return }
    await receive(route)
  }

  func deliverPendingRoute() {
    guard let pendingRoute, let openResults, openResults(pendingRoute.periodID, pendingRoute.period)
    else { return }
    self.pendingRoute = nil
  }

  /// Account removal must not replay an earlier participant's result destination.
  func discardPendingRoute() { pendingRoute = nil }

  private func receive(_ route: PushNotificationRoute) {
    pendingRoute = route
    deliverPendingRoute()
  }

  private func foregroundOptions(route: PushNotificationRoute?, identifier: String)
    -> UNNotificationPresentationOptions
  {
    if identifier.hasPrefix("folding.daily-limit.") {
      return localDailyLimitEnabled ? [.banner, .sound] : []
    }
    return registration?.shouldPresent(route, identifier: identifier) == true
      ? [.banner, .sound] : []
  }
}
