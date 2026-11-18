import FoldingDomain
import Foundation
import SwiftUI
import UIKit

import enum FoldingData.SetupAction
import struct FoldingData.SetupProgress
import enum FoldingData.SetupStep

/// In-memory setup walkthrough for recording the onboarding flow on the Duo simulator.
/// Simulator hinge changes stand in for the user's Shortcuts automations firing.
@MainActor final class OnboardingFixture {
  private let model: FoldingPresentation
  private var step: SetupStep = .welcome
  private var hinge: HingePosture?

  init(model: FoldingPresentation) {
    self.model = model
    model.setup = Self.progress(.welcome)
  }

  func advance(_ action: SetupAction) -> SetupProgress {
    switch (action, step) {
    case (.next, .welcome): step = .openingInstructions
    case (.next, .openingInstructions): step = .openingReady
    case (.next, .openingPassed): step = .closingInstructions
    case (.next, .closingInstructions): step = .closingReady
    case (.next, .closingPassed): step = .complete
    case (.test, .openingReady): step = .awaitingOpening
    case (.test, .closingReady): step = .awaitingClosing
    case (.retry, .openingRetry): step = .openingReady
    case (.retry, .closingRetry): step = .closingReady
    case (.dismiss, _), (.restart, _): break
    default: break
    }
    return Self.progress(step)
  }

  /// A fold in the expected direction while a test waits behaves like the automation running.
  func hingeChanged(to posture: HingePosture?) {
    defer { hinge = posture }
    guard let posture, posture != hinge else { return }
    let expected: (SetupStep, HingePosture, SetupStep)? =
      step == .awaitingOpening
      ? (.awaitingOpening, .open, .openingPassed)
      : step == .awaitingClosing ? (.awaitingClosing, .closed, .closingPassed) : nil
    guard let expected, posture == expected.1, hinge != nil else { return }
    Task {
      // Roughly how long a personal automation takes to run.
      try? await Task.sleep(for: .milliseconds(2200))
      guard self.step == expected.0 else { return }
      self.step = expected.2
      self.model.setup = Self.progress(self.step)
    }
  }

  private static func progress(_ step: SetupStep) -> SetupProgress {
    let opening =
      [
        .openingPassed, .closingInstructions, .closingReady, .awaitingClosing, .closingRetry,
        .closingPassed, .complete,
      ].contains(step)
    let closing = step == .closingPassed || step == .complete
    var fields = [
      "\"schemaVersion\":1", "\"flowID\":\"33333333-3333-3333-3333-333333333333\"",
      "\"deviceID\":\"11111111-1111-1111-1111-111111111111\"",
      "\"generation\":{\"revision\":0,\"reset_id\":\"00000000-0000-0000-0000-000000000000\"}",
      "\"step\":\"\(step.rawValue)\"",
    ]
    if step.isWaiting { fields.append("\"attemptID\":\"66666666-6666-6666-6666-666666666666\"") }
    if opening { fields.append("\"openingEventID\":\"44444444-4444-4444-4444-444444444444\"") }
    if closing { fields.append("\"closingEventID\":\"55555555-5555-5555-5555-555555555555\"") }
    return try! JSONDecoder().decode(
      SetupProgress.self, from: Data("{\(fields.joined(separator: ","))}".utf8))
  }
}

/// Watches the simulated hinge for the onboarding walkthrough.
struct OnboardingHingeWatcher: ViewModifier {
  let fixture: OnboardingFixture?
  func body(content: Content) -> some View {
    if let fixture, #available(iOS 27.1, *) {
      content.onHingeChange { _, context in
        guard let status = context.hinge?.status else { return fixture.hingeChanged(to: nil) }
        fixture.hingeChanged(to: status == .closed ? .closed : .open)
      }
    } else {
      content
    }
  }
}
