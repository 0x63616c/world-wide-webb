import Foundation

/// One frame: which raw capture to use and the words above the device.
public struct RFrameShot: Decodable {
    public let screen: String
    public var appearance: String = "light"
    public let eyebrow: String
    public let headline: String
    enum CodingKeys: String, CodingKey { case screen, appearance, eyebrow, headline }
    public init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        screen = try values.decode(String.self, forKey: .screen)
        guard !screen.isEmpty, screen.allSatisfy({ $0.isLetter || $0.isNumber || $0 == "-" || $0 == "_" }) else {
            throw DecodingError.dataCorruptedError(forKey: .screen, in: values, debugDescription: "Screen must be a capture basename")
        }
        appearance = try values.decodeIfPresent(String.self, forKey: .appearance) ?? "light"
        guard ["light", "dark"].contains(appearance) else {
            throw DecodingError.dataCorruptedError(forKey: .appearance, in: values, debugDescription: "Appearance must be light or dark")
        }
        eyebrow = try values.decode(String.self, forKey: .eyebrow)
        headline = try values.decode(String.self, forKey: .headline)
    }
}

/// apps/<app>/screenshots.json: the frames in App Store order.
public struct RFrameConfig: Decodable { public let shots: [RFrameShot] }

