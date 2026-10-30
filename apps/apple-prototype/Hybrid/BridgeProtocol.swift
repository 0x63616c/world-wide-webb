import Foundation

enum JSONValue: Codable, Equatable, Sendable {
    case null, bool(Bool), number(Double), string(String), array([JSONValue]), object([String: JSONValue])

    init(from decoder: any Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() { self = .null }
        else if let value = try? container.decode(Bool.self) { self = .bool(value) }
        else if let value = try? container.decode(Double.self) { self = .number(value) }
        else if let value = try? container.decode(String.self) { self = .string(value) }
        else if let value = try? container.decode([JSONValue].self) { self = .array(value) }
        else { self = .object(try container.decode([String: JSONValue].self)) }
    }

    func encode(to encoder: any Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .null: try container.encodeNil()
        case .bool(let value): try container.encode(value)
        case .number(let value): try container.encode(value)
        case .string(let value): try container.encode(value)
        case .array(let value): try container.encode(value)
        case .object(let value): try container.encode(value)
        }
    }

    var string: String? { if case .string(let value) = self { value } else { nil } }
    var number: Double? { if case .number(let value) = self { value } else { nil } }
}

struct NativeRequest: Decodable, Equatable, Sendable {
    let channel: String
    let id: String
    let method: String
    let params: [String: JSONValue]?

    static func parse(_ raw: String) -> Self? {
        guard let request = try? JSONDecoder().decode(Self.self, from: Data(raw.utf8)),
              request.channel == "control-center-native", !request.id.isEmpty, !request.method.isEmpty else { return nil }
        return request
    }
}

struct NativeResponse: Encodable, Equatable, Sendable {
    let channel = "control-center-native"
    let id: String
    let ok: Bool
    let result: JSONValue?
    let error: String?

    static func success(id: String, result: JSONValue = .null) -> Self {
        Self(id: id, ok: true, result: result, error: nil)
    }

    static func failure(id: String, message: String) -> Self {
        Self(id: id, ok: false, result: nil, error: message)
    }

    func encoded() throws -> String { String(decoding: try JSONEncoder().encode(self), as: UTF8.self) }
}

struct BootReport: Decodable, Sendable {
    let channel: String
    let rendered: Bool

    static func parse(_ raw: String) -> Self? {
        guard let report = try? JSONDecoder().decode(Self.self, from: Data(raw.utf8)),
              report.channel == "control-center-shell" else { return nil }
        return report
    }
}

enum BridgeParameters {
    static func brightness(_ params: [String: JSONValue]?) -> Double? {
        guard let value = params?["level"]?.number, value.isFinite else { return nil }
        return min(1, max(0, value))
    }
}
