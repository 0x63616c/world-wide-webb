import Foundation

#if canImport(FoundationNetworking)
    import FoundationNetworking
#endif

/// Fetches by entity ID through the API; never uses HA's private entity_picture URL.
public struct SonosArtworkAPI: Sendable {
    private let configuration: PanelConfiguration?
    private let transport: any PanelTransport
    private let eventLog: PanelEventLog

    public init(
        configuration: PanelConfiguration?, transport: (any PanelTransport)? = nil,
        eventLog: PanelEventLog = .shared
    ) {
        self.configuration = configuration
        self.eventLog = eventLog
        let session = URLSessionConfiguration.ephemeral
        session.urlCache = nil
        session.httpCookieStorage = nil
        session.urlCredentialStorage = nil
        self.transport =
            transport ?? URLSession(configuration: session, delegate: SonosArtworkRedirectPolicy(), delegateQueue: nil)
    }

    public func artwork(room: String) async throws -> Data {
        let started = ProcessInfo.processInfo.systemUptime
        var status: Int?
        var outcome = "ok"
        defer {
            let elapsed = Int((ProcessInfo.processInfo.systemUptime - started) * 1000)
            eventLog.record(
                category: "network", action: "GET.sonos_artwork",
                outcome: outcome == "ok" && elapsed >= 1000 ? "slow" : outcome,
                status: status, durationMs: elapsed)
        }
        do {
            guard room.count <= 255, room.range(of: "^media_player\\.[a-z0-9_]+$", options: .regularExpression) != nil
            else {
                throw PanelAPIError.transport("Invalid room.")
            }
            guard let configuration, PanelConfiguration.isValidBaseURL(configuration.baseURL),
                configuration.requestTimeout.isFinite, configuration.requestTimeout > 0
            else { throw PanelAPIError.notConfigured }
            let url = configuration.baseURL.appendingPathComponent("media/sonos")
                .appendingPathComponent(room).appendingPathComponent("artwork")
            var request = URLRequest(
                url: url, cachePolicy: .reloadIgnoringLocalCacheData,
                timeoutInterval: min(configuration.requestTimeout, 10))
            request.setValue("image/jpeg, image/png, image/webp", forHTTPHeaderField: "Accept")
            let (data, response): (Data, HTTPURLResponse)
            do { (data, response) = try await transport.send(request) } catch is CancellationError {
                throw CancellationError()
            } catch let error as URLError where error.code == .cancelled { throw CancellationError() } catch {
                throw PanelAPIError.transport("Artwork unavailable.")
            }
            status = response.statusCode
            try Task.checkCancellation()
            guard response.statusCode == 200 else { throw PanelAPIError.http(status: response.statusCode) }
            guard let type = response.mimeType?.lowercased(), ["image/jpeg", "image/png", "image/webp"].contains(type),
                !data.isEmpty, data.count <= 10 * 1024 * 1024
            else { throw PanelAPIError.decoding("Invalid artwork.") }
            return data
        } catch {
            switch error {
            case is CancellationError: outcome = "cancelled"
            case PanelAPIError.notConfigured: outcome = "not_configured"
            case PanelAPIError.transport: outcome = "transport_error"
            case PanelAPIError.decoding: outcome = "decoding_error"
            case PanelAPIError.http, PanelAPIError.server: outcome = "http_error"
            default: outcome = "error"
            }
            throw error
        }
    }
}

private final class SonosArtworkRedirectPolicy: NSObject, URLSessionTaskDelegate, Sendable {
    func urlSession(
        _ session: URLSession, task: URLSessionTask,
        willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest,
        completionHandler: @escaping @Sendable (URLRequest?) -> Void
    ) {
        completionHandler(nil)
    }
}
