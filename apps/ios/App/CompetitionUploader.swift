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
            "POST", path: "/v1/event-batches", purpose: "submit_events", body: work.body)
          guard response.operationID == work.operationID.uuidString.lowercased(),
            response.events.map(\.eventID) == work.eventIDs.map({ $0.uuidString.lowercased() })
          else { throw CompetitionTransportError.invalidResponse }
          try await store.acknowledgeCompetitionUpload(
            work, dispositions: response.events.map(\.disposition))
        }
      } catch {
        try? await store.retryCompetitionUpload(work, atMS: TrackingRuntime.nowMS + 30_000)
      }
    } catch {}
  }
}
