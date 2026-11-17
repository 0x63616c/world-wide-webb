import Foundation

/// One raw capture: the `snapshot("<screen>")` name and the appearance it was taken in.
struct Capture: Decodable, Equatable {
  let screen: String
  var appearance: String = "light"
  enum CodingKeys: String, CodingKey { case screen, appearance }
  init(screen: String, appearance: String) {
    self.screen = screen
    self.appearance = appearance
  }
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
  }

  /// fastlane snapshot writes `<raw>/<appearance>/en-US/<device>-<screen>.png`.
  func source(in raw: URL, device: String) -> URL {
    raw.appendingPathComponent(appearance).appendingPathComponent("en-US")
      .appendingPathComponent("\(device)-\(screen).png")
  }
}

/// One frame: which raw capture to use and the words above the device.
struct RFrameShot: Decodable {
  let capture: Capture
  let eyebrow: String
  let headline: String
  var screen: String { capture.screen }
  var appearance: String { capture.appearance }
  enum CodingKeys: String, CodingKey { case eyebrow, headline }
  init(from decoder: Decoder) throws {
    capture = try Capture(from: decoder)
    let values = try decoder.container(keyedBy: CodingKeys.self)
    eyebrow = try values.decode(String.self, forKey: .eyebrow)
    headline = try values.decode(String.self, forKey: .headline)
  }
}

/// projects/tendr/screenshots.json: the iPhone frames in App Store order, then the unframed
/// iPhone Duo (outer display) captures. Duo shares one gallery of at most ten images.
struct RFrameConfig: Decodable {
  static let phone = "Screenshots iPhone 18 Pro Max"
  static let duo = "Screenshots iPhone Duo"
  let shots: [RFrameShot]
  let duoShots: [Capture]
  enum CodingKeys: String, CodingKey {
    case shots
    case duoShots = "duo_shots"
  }
  init(from decoder: Decoder) throws {
    let values = try decoder.container(keyedBy: CodingKeys.self)
    shots = try values.decode([RFrameShot].self, forKey: .shots)
    duoShots = try values.decode([Capture].self, forKey: .duoShots)
    guard (1...10).contains(duoShots.count) else {
      throw DecodingError.dataCorruptedError(
        forKey: .duoShots, in: values, debugDescription: "duo_shots must list 1–10 captures")
    }
  }
}
