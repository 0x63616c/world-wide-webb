import FoldingData
import FoldingDomain
import Foundation

actor CompetitionUploader {
  private var running = false

  func upload(from store: TrackingStore, transport: CompetitionTransport) async {
    guard !running else { return }
    running = true
    defer { running = false }
    do {
      guard let work = try await store.leaseCompetitionUpload(nowMS: TrackingRuntime.nowMS) else {
        return
      }
      do {
        if work.isReset {
          struct Response: Decodable, Sendable {
            let generation: ResetGeneration
            let state: String
            let operationID: String
            enum CodingKeys: String, CodingKey {
              case generation, state
              case operationID = "operation_id"
            }
          }
          let response: Response = try await transport.protected(
            "POST", path: "/v1/resets", purpose: "reset", body: work.body)
          guard response.operationID == work.operationID.uuidString.lowercased(),
            ["acknowledged", "superseded"].contains(response.state),
            response.generation >= work.generation
          else { throw CompetitionTransportError.invalidResponse }
          if response.generation > work.generation {
            // Wait for the authoritative immutable CloudKit marker rather than inventing its creation time.
            throw CompetitionTransportError.unavailable
          }
          try await store.acknowledgeCompetitionUpload(work, dispositions: [])
        } else {
          struct Receipt: Decodable, Sendable {
            struct Event: Decodable, Sendable {
              let eventID: String
              let disposition: String
              enum CodingKeys: String, CodingKey {
                case eventID = "event_id"
                case disposition
              }
            }
            let operationID: String
            let events: [Event]
            enum CodingKeys: String, CodingKey {
              case operationID = "operation_id"
              case events
            }
          }
          let response: Receipt = try await transport.protected(
            "POST", path: work.isHistory == true ? "/v1/history-batches" : "/v1/event-batches",
            purpose: "submit_events", body: work.body)
          guard response.operationID == work.operationID.uuidString.lowercased(),
            response.events.map(\.eventID) == work.eventIDs.map({ $0.uuidString.lowercased() })
          else { throw CompetitionTransportError.invalidResponse }
          try await store.acknowledgeCompetitionUpload(
            work, dispositions: response.events.map(\.disposition))
        }
      } catch is CancellationError {
        // Account leases and transport revisions fence abandoned account work.
      } catch {
        await handle(error, work: work, store: store, transport: transport)
      }
    } catch {}
  }
  private func handle(
    _ error: Error, work: CompetitionUpload, store: TrackingStore, transport: CompetitionTransport
  ) async {
    var delay = min(3600.0, 15.0 * pow(2.0, Double(min(work.attempts ?? 0, 8))))
    do {
      if case CompetitionTransportError.service(
        let status, let code, let retryable, let retryAfter) = error
      {
        if code == "app_update_required" {
          // Preserve queued observations and operation identity until the app is updated.
          delay = max(delay, 3600)
        } else if code == "epoch_stale" || code == "generation_stale" {
          let me: CompetitionMe = try await transport.send("GET", path: "/v1/me")
          guard me.profile.membership == "joined", me.profile.restriction == "none",
            let enrollment = me.enrollment,
            enrollment.device_id == transport.deviceID.uuidString.lowercased(),
            let epoch = UUID(uuidString: enrollment.epoch_id)
          else {
            try await store.suspendCompetitionUpload()
            return
          }
          try await store.setCompetitionEpoch(epoch)
          // Never invent a private reset marker from a public generation. The next
          // CloudKit synchronization supplies its immutable marker; defer this body.
          delay = max(delay, 300)
        } else if status == 403
          || (!retryable && !["challenge_expired", "assertion_replay"].contains(code))
        {
          try await store.stopCompetitionUpload(work, reason: code)
          return
        }
        if let retryAfter, retryAfter.isFinite, retryAfter >= 0 { delay = max(delay, retryAfter) }
      } else if case CompetitionTransportError.unauthorized = error {
        // Refresh has already been attempted by the transport. Wait for sign-in.
        delay = max(delay, 300)
      }
      let jitter = Double.random(in: 0...max(1, delay * 0.1))
      let milliseconds = Int64(min(delay + jitter, 7 * 86400) * 1000)
      try await store.retryCompetitionUpload(work, atMS: TrackingRuntime.nowMS + milliseconds)
    } catch {
      try? await store.retryCompetitionUpload(work, atMS: TrackingRuntime.nowMS + 300_000)
    }
  }

}
