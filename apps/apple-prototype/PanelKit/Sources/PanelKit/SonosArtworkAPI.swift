import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// Fetches by entity ID through the API; never uses HA's private entity_picture URL.
public struct SonosArtworkAPI: Sendable {
    private let configuration: PanelConfiguration?
    private let transport: any PanelTransport

    public init(configuration: PanelConfiguration?, transport: (any PanelTransport)? = nil) {
        self.configuration = configuration
        let session = URLSessionConfiguration.ephemeral
        session.urlCache = nil
        session.httpCookieStorage = nil
        session.urlCredentialStorage = nil
        self.transport = transport ?? URLSession(configuration: session, delegate: SonosArtworkRedirectPolicy(), delegateQueue: nil)
    }

    public func artwork(room: String) async throws -> Data {
        guard room.count <= 255, room.range(of: "^media_player\\.[a-z0-9_]+$", options: .regularExpression) != nil else {
            throw PanelAPIError.transport("Invalid room.")
        }
        guard let configuration, PanelConfiguration.isValidBaseURL(configuration.baseURL),
              configuration.requestTimeout.isFinite, configuration.requestTimeout > 0 else { throw PanelAPIError.notConfigured }
        let url = configuration.baseURL.appendingPathComponent("media/sonos")
            .appendingPathComponent(room).appendingPathComponent("artwork")
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData,
                                 timeoutInterval: min(configuration.requestTimeout, 10))
        request.setValue("image/jpeg, image/png, image/webp", forHTTPHeaderField: "Accept")
        if let id = configuration.accessClientID, let secret = configuration.accessClientSecret {
            request.setValue(id, forHTTPHeaderField: "CF-Access-Client-Id")
            request.setValue(secret, forHTTPHeaderField: "CF-Access-Client-Secret")
        }
        let (data, response): (Data, HTTPURLResponse)
        do { (data, response) = try await transport.send(request) }
        catch is CancellationError { throw CancellationError() }
        catch let error as URLError where error.code == .cancelled { throw CancellationError() }
        catch { throw PanelAPIError.transport("Artwork unavailable.") }
        try Task.checkCancellation()
        guard response.statusCode == 200 else { throw PanelAPIError.http(status: response.statusCode) }
        guard let type = response.mimeType?.lowercased(), ["image/jpeg", "image/png", "image/webp"].contains(type),
              !data.isEmpty, data.count <= 10 * 1024 * 1024 else { throw PanelAPIError.decoding("Invalid artwork.") }
        return data
    }
}

private final class SonosArtworkRedirectPolicy: NSObject, URLSessionTaskDelegate, Sendable {
    func urlSession(_ session: URLSession, task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest,
                    completionHandler: @escaping @Sendable (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}
