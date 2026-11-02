import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

public protocol PanelTransport: Sendable {
    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse)
}

extension URLSession: PanelTransport {
    public func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        let (data, response) = try await data(for: request)
        guard let response = response as? HTTPURLResponse else {
            throw PanelAPIError.transport("Expected an HTTP response.")
        }
        return (data, response)
    }
}

public enum PanelAPIError: Error, Sendable, Equatable, LocalizedError {
    case notConfigured
    case transport(String)
    case http(status: Int)
    case server(code: String, message: String, httpStatus: Int?)
    case decoding(String)

    public var isServiceUnavailable: Bool {
        switch self {
        case .http(503): true
        case .server(let code, _, let status): code == "SERVICE_UNAVAILABLE" || status == 503
        default: false
        }
    }

    public var errorDescription: String? {
        switch self {
        case .notConfigured: "Panel API is not configured."
        case .transport(let message), .decoding(let message): message
        case .http(let status): "Panel API returned HTTP \(status)."
        case .server(_, let message, _): message
        }
    }
}

public struct PanelAPIClient: Sendable {
    private let configuration: PanelConfiguration?
    private let transport: any PanelTransport
    private let commandLog: PanelCommandLog

    public init(configuration: PanelConfiguration?, transport: any PanelTransport = URLSession.shared, commandLog: PanelCommandLog = .shared) {
        self.configuration = configuration
        self.transport = transport
        self.commandLog = commandLog
    }

    public func query<Output: Decodable & Sendable>(_ path: String, as: Output.Type) async throws -> Output {
        try await perform(path, method: "GET", input: nil, as: Output.self)
    }

    public func query<Input: Encodable & Sendable, Output: Decodable & Sendable>(
        _ path: String, input: Input, as: Output.Type
    ) async throws -> Output {
        try await perform(path, method: "GET", input: encode(input), as: Output.self)
    }

    public func mutation<Input: Encodable & Sendable, Output: Decodable & Sendable>(
        _ path: String, input: Input, as: Output.Type
    ) async throws -> Output {
        let data: Data
        do { data = try encode(input) }
        catch {
            commandLog.record(control: path, error: "request failed")
            throw error
        }
        return try await perform(path, method: "POST", input: data, as: Output.self)
    }

    /// Only media paths on the configured origin may receive Access credentials.
    public func photoData(collection: String, path: String) async throws -> Data {
        guard let configuration, PanelConfiguration.isValidBaseURL(configuration.baseURL),
              configuration.requestTimeout.isFinite, configuration.requestTimeout > 0,
              ["booth-photos", "wake-photos"].contains(collection),
              !path.isEmpty, !path.contains(".."), !path.contains("%"),
              path.allSatisfy({ $0.isASCII && ($0.isLetter || $0.isNumber || "-_.:/".contains($0)) }),
              !path.hasPrefix("/"), !path.contains("://") else {
            throw PanelAPIError.transport("Invalid photo path.")
        }
        let url = configuration.baseURL.appendingPathComponent("media/" + collection + "/" + path)
        var request = URLRequest(url: url, timeoutInterval: configuration.requestTimeout)
        if let id = configuration.accessClientID, let secret = configuration.accessClientSecret {
            request.setValue(id, forHTTPHeaderField: "CF-Access-Client-Id")
            request.setValue(secret, forHTTPHeaderField: "CF-Access-Client-Secret")
        }
        let (data, response) = try await transport.send(request)
        try Task.checkCancellation()
        guard response.statusCode == 200 else { throw PanelAPIError.http(status: response.statusCode) }
        guard response.mimeType?.hasPrefix("image/") == true, data.count <= 20 * 1024 * 1024 else {
            throw PanelAPIError.decoding("Invalid photo response.")
        }
        return data
    }

    private func encode<Input: Encodable>(_ input: Input) throws -> Data {
        do { return try JSONEncoder().encode(input) }
        catch { throw PanelAPIError.decoding("Could not encode request JSON.") }
    }

    private func perform<Output: Decodable & Sendable>(
        _ path: String, method: String, input: Data?, as: Output.Type
    ) async throws -> Output {
        let started = Date()
        var httpStatus: Int?
        var commandError: String?
        defer {
            if method == "POST" && !path.hasPrefix("diagnostics.") {
                let safePath = configuration.map { redacted(path, $0) } ?? path
                commandLog.record(control: safePath, input: input, status: httpStatus,
                    error: commandError, latencyMs: Int(Date().timeIntervalSince(started) * 1000))
            }
        }
        do {
            guard let configuration, PanelConfiguration.isValidBaseURL(configuration.baseURL),
                  configuration.requestTimeout.isFinite, configuration.requestTimeout > 0 else {
                throw PanelAPIError.notConfigured
            }
            guard !path.isEmpty, path.allSatisfy({ $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "." || $0 == "_") })
            else { throw PanelAPIError.transport("Invalid procedure path.") }
            let url = configuration.baseURL.appendingPathComponent("trpc").appendingPathComponent(path)
            guard var components = URLComponents(url: url, resolvingAgainstBaseURL: false) else {
                throw PanelAPIError.notConfigured
            }
            if method == "GET", let input {
                // RFC 3986 unreserved characters only; '+' must survive form-style query parsers.
                let unreserved = CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~")
                let encoded = String(decoding: input, as: UTF8.self).addingPercentEncoding(withAllowedCharacters: unreserved)
                components.percentEncodedQuery = "input=" + (encoded ?? "")
            }
            guard let requestURL = components.url else { throw PanelAPIError.notConfigured }
            var request = URLRequest(url: requestURL, cachePolicy: .reloadIgnoringLocalCacheData,
                                     timeoutInterval: configuration.requestTimeout)
            request.httpMethod = method
            request.setValue("application/json", forHTTPHeaderField: "Accept")
            if method == "POST" {
                request.httpBody = input
                request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            }
            if let id = configuration.accessClientID, let secret = configuration.accessClientSecret {
                request.setValue(id, forHTTPHeaderField: "CF-Access-Client-Id")
                request.setValue(secret, forHTTPHeaderField: "CF-Access-Client-Secret")
            }
            let data: Data
            let response: HTTPURLResponse
            do { (data, response) = try await transport.send(request) }
            catch is CancellationError { throw CancellationError() }
            catch let error as URLError where error.code == .cancelled { throw CancellationError() }
            catch { throw PanelAPIError.transport("Could not reach the panel API.") }
            httpStatus = response.statusCode
            try Task.checkCancellation()
            let decoder = JSONDecoder()
            if let failure = try? decoder.decode(ErrorEnvelope.self, from: data) {
                throw PanelAPIError.server(
                    code: redacted(failure.error.data.code, configuration),
                    message: redacted(failure.error.message, configuration),
                    httpStatus: failure.error.data.httpStatus ?? response.statusCode
                )
            }
            guard (200..<300).contains(response.statusCode) else { throw PanelAPIError.http(status: response.statusCode) }
            do { return try decoder.decode(SuccessEnvelope<Output>.self, from: data).result.data }
            catch { throw PanelAPIError.decoding("Could not decode the panel API response.") }
        } catch {
            commandError = error is CancellationError ? "cancelled" : "request failed"
            throw error
        }
    }

    private func redacted(_ value: String, _ configuration: PanelConfiguration) -> String {
        [configuration.accessClientID, configuration.accessClientSecret].compactMap { $0 }
            .filter { !$0.isEmpty }.reduce(value) { $0.replacingOccurrences(of: $1, with: "<redacted>") }
    }
}

private struct SuccessEnvelope<Output: Decodable>: Decodable {
    struct Result: Decodable { let data: Output }
    let result: Result
}

private struct ErrorEnvelope: Decodable {
    struct Failure: Decodable {
        struct Details: Decodable { let code: String; let httpStatus: Int? }
        let message: String
        let code: Int
        let data: Details
    }
    let error: Failure
}
