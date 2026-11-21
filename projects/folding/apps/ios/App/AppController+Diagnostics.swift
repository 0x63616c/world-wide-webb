import FoldingDomain
import Foundation
import SwiftUI

import struct FoldingData.TrackingDiagnosticSnapshot

extension AppController {
  func recordLifecycle(_ phase: ScenePhase) async {
    if phase == .active, !usageForeground { recordUsage("app_opened") }
    if phase == .active { usageForeground = true }
    if phase == .background {
      usageForeground = false
      AnalyticsUploader.scheduleRefresh()
    }
    await runtime.recordLifecycle(
      phase == .active ? .foreground : phase == .background ? .background : .inactive)
  }

  func makeDiagnosticReport() async throws -> TrackingDiagnosticSnapshot {
    let identity = accountChangeRevision
    var report = await runtime.diagnosticSnapshot()
    let credentials =
      await competitionAPI?.transport.diagnosticCredentialSummary() ?? [
        "session_state": "not_loaded"
      ]
    guard identity == accountChangeRevision, !accountChanging else { throw CancellationError() }
    report.context.merge(credentials) { _, new in new }
    report.context.merge([
      "server_revision": "\(diagnosticServerRevision)",
      "notification_permission": "\(String(describing: presentation.notificationAuthorization))",
      "daily_notification_enabled": "\(notifications.preferences.dailyLimit)",
      "tracking_phone":
        "\(presentation.publicTrackingPhone == .thisPhone ? "this_phone" : presentation.publicTrackingPhone == .anotherPhone ? "other_phone" : "none")",
    ]) { _, new in new }
    if let personal = presentation.analytics {
      report.context["personal_folds"] = String(describing: personal.lifetime.folds)
    }
    if let board = presentation.competition.previous {
      report.context["board_period"] = String(describing: presentation.competitionPeriod.rawValue)
      report.context["board_folds"] = String(describing: board.currentUser?.folds ?? 0)
      report.context["board_cached_at"] = String(describing: board.updatedAt.ISO8601Format())
    }
    return report
  }

  func checkDiagnosticConnection() async throws {
    struct Health: Decodable, Sendable {
      let status: String
      let workerVersion: String
      enum CodingKeys: String, CodingKey {
        case status
        case workerVersion = "worker_version"
      }
    }
    let api = try await competitionClient()
    let health: Health = try await api.transport.send(
      "GET", path: "/v1/health", authenticated: false)
    guard health.status == "ok" else { throw CompetitionTransportError.unavailable }
    diagnosticServerRevision =
      health.workerVersion.count == 40
        && health.workerVersion.utf8.allSatisfy {
          (48...57).contains($0) || (97...102).contains($0)
        } ? health.workerVersion : "unconfigured"
  }
}
