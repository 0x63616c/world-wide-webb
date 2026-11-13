import Foundation

public struct Shortcut: Codable, Equatable, Sendable {
  public var keyCode: UInt32
  public var modifiers: UInt32
  public var key: String
  public static let command: UInt32 = 1 << 8
  public static let shift: UInt32 = 1 << 9
  public static let option: UInt32 = 1 << 11
  public static let control: UInt32 = 1 << 12
  public static let hyper = command | shift | option | control
  public static let `default` = Shortcut(keyCode: 15, modifiers: hyper, key: "R")
  public init(keyCode: UInt32, modifiers: UInt32, key: String) {
    self.keyCode = keyCode
    self.modifiers = modifiers
    self.key = key
  }
  public var label: String {
    if modifiers == Self.hyper { return "HYPR + " + key }
    return
      ([(Self.control, "⌃"), (Self.option, "⌥"), (Self.shift, "⇧"), (Self.command, "⌘")].filter {
        modifiers & $0.0 != 0
      }.map(\.1) + [key]).joined(separator: " + ")
  }
  public var isValid: Bool {
    modifiers & (Self.control | Self.option | Self.command) != 0 && !key.isEmpty
  }
}
