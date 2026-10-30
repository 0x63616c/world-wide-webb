import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// Exact features/cameras/contract.ts projection. No HA attributes or URLs.
public struct PanelCamera: Decodable, Sendable, Equatable, Identifiable {
    public let id: String
    public let name: String
    public let state: String

    public var canSnapshot: Bool { !["unavailable", "unknown", "off"].contains(state) }
}

public struct CamerasAPI: Sendable {
    private let configuration: PanelConfiguration?
    private let transport: any PanelTransport
    private let client: PanelAPIClient

    public init(configuration: PanelConfiguration?, transport: (any PanelTransport)? = nil) {
        let transport = transport ?? Self.makeTransport()
        self.configuration = configuration
        self.transport = transport
        client = PanelAPIClient(configuration: configuration, transport: transport)
    }

    public func list() async throws -> [PanelCamera] {
        let cameras = try await client.query("cameras.list", as: [PanelCamera].self)
        guard cameras.allSatisfy({ Self.validID($0.id) }), Set(cameras.map(\.id)).count == cameras.count else {
            throw PanelAPIError.decoding("Invalid camera list.")
        }
        return cameras
    }

    public func snapshot(id: String) async throws -> Data {
        guard Self.validID(id) else { throw PanelAPIError.transport("Invalid camera ID.") }
        guard let configuration, PanelConfiguration.isValidBaseURL(configuration.baseURL),
              configuration.requestTimeout.isFinite, configuration.requestTimeout > 0 else {
            throw PanelAPIError.notConfigured
        }
        let url = configuration.baseURL.appendingPathComponent("media/cameras")
            .appendingPathComponent(id).appendingPathComponent("snapshot")
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData,
                                 timeoutInterval: min(configuration.requestTimeout, 10))
        request.setValue("image/jpeg, image/png, image/webp", forHTTPHeaderField: "Accept")
        if let id = configuration.accessClientID, let secret = configuration.accessClientSecret {
            request.setValue(id, forHTTPHeaderField: "CF-Access-Client-Id")
            request.setValue(secret, forHTTPHeaderField: "CF-Access-Client-Secret")
        }
        let data: Data
        let response: HTTPURLResponse
        do { (data, response) = try await transport.send(request) }
        catch is CancellationError { throw CancellationError() }
        catch let error as URLError where error.code == .cancelled { throw CancellationError() }
        catch { throw PanelAPIError.transport("Camera snapshot unavailable.") }
        try Task.checkCancellation()
        guard response.statusCode == 200 else { throw PanelAPIError.http(status: response.statusCode) }
        guard let type = response.mimeType?.lowercased(), ["image/jpeg", "image/png", "image/webp"].contains(type),
              !data.isEmpty, data.count <= 10 * 1024 * 1024 else {
            throw PanelAPIError.decoding("Invalid camera image.")
        }
        return data
    }

    private static func validID(_ value: String) -> Bool {
        guard value.hasPrefix("camera."), value.count > 7, value.count <= 255 else { return false }
        return value.dropFirst(7).utf8.allSatisfy { (97...122).contains($0) || (48...57).contains($0) || $0 == 95 }
    }

    private static func makeTransport() -> URLSession {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.urlCache = nil
        configuration.httpCookieStorage = nil
        configuration.urlCredentialStorage = nil
        return URLSession(configuration: configuration, delegate: CameraRedirectPolicy(), delegateQueue: nil)
    }
}

/// Access challenges must fail closed; never forward custom Access headers to a redirect destination.
private final class CameraRedirectPolicy: NSObject, URLSessionTaskDelegate, Sendable {
    func urlSession(_ session: URLSession, task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest,
                    completionHandler: @escaping @Sendable (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}
