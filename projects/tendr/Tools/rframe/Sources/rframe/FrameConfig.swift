import Foundation

/// One frame: which raw capture to use and the words above the device.
struct RFrameShot: Decodable {
  let screen: String
  var appearance: String = "light"
  let eyebrow: String
  let headline: String
  enum CodingKeys: String, CodingKey { case screen, appearance, eyebrow, headline }
  init(from decoder: Decoder) throws {
    let values = try decoder.container(keyedBy: CodingKeys.self)
    screen = try values.decode(String.self, forKey: .screen)
    guard !screen.isEmpty,
      screen.allSatisfy({ $0.isLetter || $0.isNumber || $0 == "-" || $0 == "_" })
    else {
      throw DecodingError.dataCorruptedError(
        forKey: .screen, in: values, debugDescription: "Screen must be a capture basename")
    }
    appearance = try values.decodeIfPresent(String.self, forKey: .appearance) ?? "light"
    guard ["light", "dark"].contains(appearance) else {
      throw DecodingError.dataCorruptedError(
        forKey: .appearance, in: values, debugDescription: "Appearance must be light or dark")
    }
    eyebrow = try values.decode(String.self, forKey: .eyebrow)
    headline = try values.decode(String.self, forKey: .headline)
  }
}

/// projects/tendr/screenshots.json: the frames in App Store order.
struct RFrameConfig: Decodable { let shots: [RFrameShot] }
