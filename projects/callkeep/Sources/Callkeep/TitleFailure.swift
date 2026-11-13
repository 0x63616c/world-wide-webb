import Foundation
import FoundationModels

struct TitleFailure {
  let message: String
  let event: AppLog.Event
  static func classify(_ error: Error) -> Self {
    let ns = error as NSError
    // macOS 27 can return this newer error even to apps built with the macOS 26 SDK.
    if ns.domain == "FoundationModels.LanguageModelError" && ns.code == 2 {
      return Self(
        message: "Apple’s on-device model declined this transcript. You can name it manually.",
        event: .titleGuardrail)
    }
    if #available(macOS 26, *), let modelError = error as? LanguageModelSession.GenerationError {
      switch modelError {
      case .guardrailViolation, .refusal:
        return Self(
          message: "Apple’s on-device model declined this transcript. You can name it manually.",
          event: .titleGuardrail)
      case .exceededContextWindowSize:
        return Self(
          message: "The conversation is too long for the on-device model.",
          event: .titleContextLimit)
      case .assetsUnavailable:
        return Self(
          message: "The on-device model isn’t available right now.", event: .titleUnavailable)
      case .unsupportedLanguageOrLocale:
        return Self(
          message: "The on-device model doesn’t support this language.",
          event: .titleUnsupportedLanguage)
      case .rateLimited:
        return Self(
          message: "The on-device model is busy. Try again later.", event: .titleRateLimited)
      default: break
      }
    }
    return Self(message: "Couldn’t suggest a title. Try again later.", event: .titleFailed)
  }
}
