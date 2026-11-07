import CoreFoundation
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

/// Shared REST transport for every native feature. Credentials never follow a
/// redirect, and physical mutations are never retried by this layer.
public struct PanelAPIClient: Sendable {
    public static let defaultTransport: URLSession = URLSession(
        configuration: .ephemeral,
        delegate: PhotoSessionDelegate(), delegateQueue: nil)
    private let configuration: PanelConfiguration?
    private let transport: any PanelTransport
    private let commandLog: PanelCommandLog
    public init(
        configuration: PanelConfiguration?, transport: any PanelTransport = PanelAPIClient.defaultTransport,
        commandLog: PanelCommandLog = .shared
    ) {
        self.configuration = configuration
        self.transport = transport
        self.commandLog = commandLog
    }
    public func get<Output: Decodable & Sendable>(_ path: String, as: Output.Type) async throws -> Output {
        try await perform(path, method: "GET", input: nil, as: Output.self)
    }
    public func get<Input: Encodable & Sendable, Output: Decodable & Sendable>(
        _ path: String, input: Input, as: Output.Type
    ) async throws -> Output {
        try await perform(path, method: "GET", input: encode(input), as: Output.self)
    }
    public func post<Input: Encodable & Sendable, Output: Decodable & Sendable>(
        _ path: String, input: Input, as: Output.Type
    ) async throws -> Output {
        try await perform(path, method: "POST", input: encode(input), as: Output.self)
    }
    public func patch<Input: Encodable & Sendable, Output: Decodable & Sendable>(
        _ path: String, input: Input, as: Output.Type
    ) async throws -> Output {
        try await perform(path, method: "PATCH", input: encode(input), as: Output.self)
    }
    public func delete<Output: Decodable & Sendable>(_ path: String, as: Output.Type) async throws -> Output {
        try await perform(path, method: "DELETE", input: nil, as: Output.self)
    }
    public static func component(_ value: String) throws -> String {
        guard !value.isEmpty, value.utf8.count <= 200,
            value.allSatisfy({ $0.isASCII && ($0.isLetter || $0.isNumber || "_-".contains($0)) })
        else {
            throw PanelAPIError.transport("Invalid resource identifier.")
        }
        return value
    }
    private func configured() throws -> PanelConfiguration {
        guard let c = configuration, PanelConfiguration.isValidBaseURL(c.baseURL),
            c.requestTimeout.isFinite, c.requestTimeout > 0
        else { throw PanelAPIError.notConfigured }
        return c
    }
    private func authorize(_ request: inout URLRequest, _ c: PanelConfiguration) {
        if let token = c.apiToken { request.setValue("Bearer " + token, forHTTPHeaderField: "Authorization") }
        if let id = c.accessClientID, let secret = c.accessClientSecret {
            request.setValue(id, forHTTPHeaderField: "CF-Access-Client-Id")
            request.setValue(secret, forHTTPHeaderField: "CF-Access-Client-Secret")
        }
    }
    public func photoData(collection: String, path: String) async throws -> Data {
        let c = try configured()
        let prefix = "/media/booth-photos/"
        let path = path.hasPrefix(prefix) ? String(path.dropFirst(prefix.count)) : path
        guard collection == "booth-photos", !path.isEmpty, !path.contains(".."), !path.contains("%"),
            !path.hasPrefix("/"), !path.contains(":"),
            path.allSatisfy({ $0.isASCII && ($0.isLetter || $0.isNumber || "-_./".contains($0)) })
        else {
            throw PanelAPIError.transport("Invalid photo path.")
        }
        var request = URLRequest(
            url: c.baseURL.appendingPathComponent("media/booth-photos/" + path),
            timeoutInterval: c.requestTimeout)
        authorize(&request, c)
        let (data, response) = try await transport.send(request)
        try Task.checkCancellation()
        guard response.statusCode == 200 else { throw PanelAPIError.http(status: response.statusCode) }
        guard response.mimeType?.hasPrefix("image/") == true, data.count <= 20 * 1024 * 1024 else {
            throw PanelAPIError.decoding("Invalid photo response.")
        }
        return data
    }
    public func uploadBoothPhoto(jpeg: Data, capturedAt: Date) async throws {
        let milliseconds = capturedAt.timeIntervalSince1970 * 1000
        guard jpeg.count >= 3, jpeg.starts(with: [0xff, 0xd8, 0xff]), jpeg.count <= 4 * 1024 * 1024,
            milliseconds.isFinite, milliseconds > 0, milliseconds < Double(Int64.max)
        else {
            throw PanelAPIError.transport("Invalid photo.")
        }
        let c = try configured()
        var request = URLRequest(
            url: c.baseURL.appendingPathComponent("media/booth-photo"), timeoutInterval: c.requestTimeout)
        request.httpMethod = "POST"
        request.httpBody = jpeg
        request.setValue("image/jpeg", forHTTPHeaderField: "Content-Type")
        request.setValue("photo", forHTTPHeaderField: "x-mode")
        request.setValue(String(Int64(milliseconds)), forHTTPHeaderField: "x-captured-at")
        authorize(&request, c)
        let (data, response) = try await transport.send(request)
        try Task.checkCancellation()
        guard response.statusCode == 201 else { throw PanelAPIError.http(status: response.statusCode) }
        struct Receipt: Decodable {
            let id: String
            let path: String
        }
        guard let receipt = try? JSONDecoder().decode(Receipt.self, from: data), !receipt.id.isEmpty,
            !receipt.path.isEmpty
        else { throw PanelAPIError.decoding("Photo save wasn’t confirmed.") }
    }
    private func encode<Input: Encodable>(_ input: Input) throws -> Data {
        do { return try JSONEncoder().encode(input) } catch {
            throw PanelAPIError.decoding("Could not encode request JSON.")
        }
    }
    private func perform<Output: Decodable & Sendable>(
        _ path: String, method: String, input: Data?, as: Output.Type
    ) async throws -> Output {
        let started = Date()
        var status: Int?
        var failure: String?
        defer {
            if method != "GET" && path != "diagnostics" {
                // Only the resource category is logged, never identifiers or credentials.
                commandLog.record(
                    control: path.split(separator: "/").first.map(String.init) ?? "command",
                    input: input, status: status, error: failure,
                    latencyMs: Int(Date().timeIntervalSince(started) * 1000))
            }
        }
        do {
            let c = try configured()
            guard !path.isEmpty, !path.hasPrefix("/"), !path.contains(".."),
                path.allSatisfy({ $0.isASCII && ($0.isLetter || $0.isNumber || "-_/".contains($0)) })
            else {
                throw PanelAPIError.transport("Invalid resource path.")
            }
            let url = c.baseURL.appendingPathComponent("api/v1/" + path)
            guard var parts = URLComponents(url: url, resolvingAgainstBaseURL: false) else {
                throw PanelAPIError.notConfigured
            }
            if method == "GET", let input {
                guard let fields = try JSONSerialization.jsonObject(with: input) as? [String: Any] else {
                    throw PanelAPIError.transport("Invalid query parameters.")
                }
                let allowed = CharacterSet(
                    charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~")
                parts.percentEncodedQuery = try fields.keys.sorted().compactMap { key -> String? in
                    guard let value = fields[key], !(value is NSNull) else { return nil }
                    let text: String
                    if let value = value as? String {
                        text = value
                    } else if let value = value as? NSNumber {
                        text =
                            CFGetTypeID(value) == CFBooleanGetTypeID()
                            ? (value.boolValue ? "true" : "false") : value.stringValue
                    } else {
                        throw PanelAPIError.transport("Invalid query parameter.")
                    }
                    return key.addingPercentEncoding(withAllowedCharacters: allowed)! + "="
                        + text.addingPercentEncoding(withAllowedCharacters: allowed)!
                }.joined(separator: "&")
            }
            guard let url = parts.url else { throw PanelAPIError.notConfigured }
            var request = URLRequest(
                url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: c.requestTimeout)
            request.httpMethod = method
            request.setValue("application/json", forHTTPHeaderField: "Accept")
            if method != "GET", let input {
                request.httpBody = input
                request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            }
            authorize(&request, c)
            let data: Data
            let response: HTTPURLResponse
            do { (data, response) = try await transport.send(request) } catch is CancellationError {
                throw CancellationError()
            } catch let error as URLError where error.code == .cancelled { throw CancellationError() } catch {
                throw PanelAPIError.transport("Could not reach the panel API.")
            }
            status = response.statusCode
            try Task.checkCancellation()
            guard (200..<300).contains(response.statusCode) else {
                if let body = try? JSONDecoder().decode(RESTFailure.self, from: data) {
                    let message = [c.apiToken, c.accessClientID, c.accessClientSecret].compactMap { $0 }
                        .filter { !$0.isEmpty }.reduce(body.error) {
                            $0.replacingOccurrences(of: $1, with: "<redacted>")
                        }
                    throw PanelAPIError.server(
                        code: Self.code(response.statusCode), message: message, httpStatus: response.statusCode)
                }
                throw PanelAPIError.http(status: response.statusCode)
            }
            do { return try JSONDecoder().decode(Output.self, from: data) } catch {
                throw PanelAPIError.decoding("Could not decode the panel API response.")
            }
        } catch {
            failure = error is CancellationError ? "cancelled" : "request failed"
            throw error
        }
    }
    private static func code(_ status: Int) -> String {
        switch status {
        case 400, 422: "BAD_REQUEST"
        case 401: "UNAUTHORIZED"
        case 403: "FORBIDDEN"
        case 404: "NOT_FOUND"
        case 409: "CONFLICT"
        case 500: "INTERNAL_SERVER_ERROR"
        case 503: "SERVICE_UNAVAILABLE"
        default: "HTTP_ERROR"
        }
    }
}

private struct RESTFailure: Decodable { let error: String }
