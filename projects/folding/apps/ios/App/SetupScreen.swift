import FoldingData
import FoldingDomain
import SwiftUI

private enum HingePosture { case closed, partiallyOpen, fullyOpen }

struct SetupScreen: View {
  @Bindable var model: FoldingPresentation
  let actions: FoldingActions
  @State private var hinge: HingePosture?
  @State private var shouldAutoTest = false
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  private var step: SetupStep { model.setup?.step ?? .welcome }
  private var closing: Bool {
    [.closingInstructions, .closingReady, .awaitingClosing, .closingPassed, .closingRetry].contains(
      step)
  }
  private var passed: Bool { step == .openingPassed || step == .closingPassed || step == .complete }
  private var readyForTest: Bool {
    guard let hinge else { return false }
    if step == .openingReady { return hinge == .closed }
    if step == .closingReady { return hinge != .closed }
    return true
  }
  private var showingAutomationInstructions: Bool {
    step == .openingInstructions || step == .closingInstructions
  }
  private var compactIllustration: Bool { true }

  @ViewBuilder var body: some View {
    if #available(iOS 27.1, *) {
      content.onHingeChange { _, context in
        guard let status = context.hinge?.status else {
          hinge = nil
          return
        }
        if status == .closed {
          hinge = .closed
        } else if status == .fullyOpen {
          hinge = .fullyOpen
        } else {
          hinge = .partiallyOpen
        }
      }
    } else {
      content
    }
  }

  private var content: some View {
    NavigationStack {
      GeometryReader { geometry in
        ScrollView {
          VStack(spacing: 16) {
            FoldIllustration(
              open: hinge.map { $0 != .closed } ?? (step != .welcome && !closing), success: passed,
              compact: compactIllustration
            )
            .id(step)
            .frame(height: 112)
            .accessibilityHidden(true)
            Text(title).font(.largeTitle.bold()).multilineTextAlignment(.center)
            if let hinge, step.isWaiting || shouldAutoTest {
              Label(hingeStatus(hinge), systemImage: "iphone.gen3")
                .font(.subheadline.weight(.medium))
                .foregroundStyle(.secondary)
            }
            if let sentence {
              Text(sentence).font(.body).foregroundStyle(.secondary).multilineTextAlignment(.center)
            }
            if step.isWaiting { ProgressView().padding(.top, 8) }
            if showingAutomationInstructions || step == .openingReady || step == .closingReady
              || step == .openingRetry || step == .closingRetry
            {
              automationGuide
            }
            if step == .openingRetry || step == .closingRetry {
              Button(String(localized: "action.retry", defaultValue: "Retry")) {
                shouldAutoTest = true
                perform(.retry)
              }
              .buttonStyle(.bordered)
            }
            if showingAutomationInstructions {
              Button(String(localized: "setup.addedAutomation", defaultValue: "I've added it")) {
                shouldAutoTest = true
                perform(.next)
              }
              .buttonStyle(.borderedProminent)
              .foregroundStyle(FoldingTint.onTint)
              .disabled(model.operation != nil)
            }
            if (step == .openingReady || step == .closingReady)
              && (!shouldAutoTest || hinge == nil)
            {
              Button(String(localized: "setup.startTest", defaultValue: "Start test")) {
                if hinge == nil {
                  perform(.test)
                } else {
                  shouldAutoTest = true
                  beginTestWhenReady()
                }
              }
              .buttonStyle(.borderedProminent)
              .foregroundStyle(FoldingTint.onTint)
              .disabled(model.operation != nil || (hinge != nil && !readyForTest))
            }
            if step == .complete {
              Button(String(localized: "action.done", defaultValue: "Done")) { dismissSetup() }
                .buttonStyle(.borderedProminent)
                .foregroundStyle(FoldingTint.onTint)
            }
            if step == .welcome {
              Button(
                hinge == nil
                  ? String(localized: "setup.confirmClosed", defaultValue: "My iPhone is closed")
                  : String(localized: "action.continue", defaultValue: "Continue")
              ) {
                guard hinge == nil || hinge == .closed else { return }
                perform(.next)
              }
              .buttonStyle(.borderedProminent)
              .disabled(hinge != nil && hinge != .closed || model.operation != nil)
            }
            if !model.showInitialSetup && step != .complete {
              Button(String(localized: "action.cancel", defaultValue: "Cancel")) {
                dismissSetup()
              }
              .disabled(model.operation != nil)
            }
          }
          .frame(maxWidth: 480)
          .frame(minHeight: geometry.size.height, alignment: .center)
          .padding(.horizontal, 24)
          .frame(maxWidth: .infinity)
        }
      }
      .animation(reduceMotion ? nil : .easeInOut(duration: 0.25), value: step)
    }
    .interactiveDismissDisabled()
    .onChange(of: hinge) { _, _ in beginTestWhenReady() }
    .onChange(of: step) { _, next in
      if next == .openingPassed || next == .closingPassed {
        AccessibilityNotification.Announcement(
          String(localized: "setup.testPassed", defaultValue: "Test passed")
        ).post()
        Task {
          try? await Task.sleep(for: .milliseconds(700))
          if model.setup?.step == next { perform(.next) }
        }
      } else if next == .openingReady || next == .closingReady {
        beginTestWhenReady()
      }
    }
  }

  private var automationGuide: some View {
    VStack(alignment: .center, spacing: 12) {
      Text(
        closing
          ? String(localized: "setup.triggerClosed", defaultValue: "Automation → Display → Closed")
          : String(localized: "setup.triggerOpen", defaultValue: "Automation → Display → Open")
      )
      .font(.subheadline).foregroundStyle(.secondary)
      Text(
        closing
          ? String(localized: "intent.recordClosing.title", defaultValue: "Log iPhone Closed")
          : String(localized: "intent.recordOpening.title", defaultValue: "Log iPhone Opened")
      )
      .font(.headline)
      if showingAutomationInstructions {
        Text(
          String(
            localized: "setup.lockedHelp",
            defaultValue: "Allow the shortcut to run while locked."))
        Text(
          String(
            localized: "setup.existingHelp",
            defaultValue: "Edit existing automations to avoid duplicates."))
      }
      if let open = actions.openShortcuts {
        Button(String(localized: "setup.openShortcuts", defaultValue: "Open Shortcuts")) {
          open()
        }
        .buttonStyle(.bordered)
        .controlSize(.large)
      }
    }
    .frame(maxWidth: .infinity, alignment: .center)
  }

  private func hingeStatus(_ status: HingePosture) -> String {
    if status == .closed {
      return String(localized: "setup.hingeClosed", defaultValue: "Closed")
    }
    if status == .fullyOpen {
      return String(localized: "setup.hingeOpen", defaultValue: "Open")
    }
    return String(localized: "setup.hingePartlyOpen", defaultValue: "Partly open")
  }

  private var title: String {
    switch step {
    case .welcome: String(localized: "setup.welcome", defaultValue: "Welcome to Folding")
    case .openingInstructions:
      String(localized: "setup.openingAutomation", defaultValue: "Track opening")
    case .closingInstructions:
      String(localized: "setup.closingAutomation", defaultValue: "Track closing")
    case .openingReady:
      hinge == nil || !shouldAutoTest
        ? String(localized: "setup.openingAutomation", defaultValue: "Track opening")
        : readyForTest
          ? String(localized: "setup.openDevice", defaultValue: "Open your iPhone")
          : String(localized: "setup.startClosed", defaultValue: "Close your iPhone first.")
    case .closingReady:
      hinge == nil || !shouldAutoTest
        ? String(localized: "setup.closingAutomation", defaultValue: "Track closing")
        : readyForTest
          ? String(localized: "setup.closeDevice", defaultValue: "Close your iPhone")
          : String(localized: "setup.startOpen", defaultValue: "Open your iPhone first.")
    case .awaitingOpening: String(localized: "setup.openDevice", defaultValue: "Open your iPhone")
    case .awaitingClosing: String(localized: "setup.closeDevice", defaultValue: "Close your iPhone")
    case .openingPassed, .closingPassed:
      String(localized: "setup.testPassed", defaultValue: "Test passed")
    case .openingRetry, .closingRetry:
      String(localized: "setup.noEvent", defaultValue: "No event yet")
    case .complete: String(localized: "setup.complete", defaultValue: "You're set")
    }
  }

  private var sentence: String? {
    switch step {
    case .welcome:
      String(
        localized: "setup.welcomeDetail",
        defaultValue: "Close your iPhone to begin. Then add and test both Shortcuts automations.")
    case .openingInstructions, .closingInstructions: nil
    case .openingReady:
      hinge == nil
        ? String(
          localized: "setup.manualOpen", defaultValue: "Start closed. Then open your iPhone.")
        : nil
    case .closingReady:
      hinge == nil
        ? String(
          localized: "setup.manualClose", defaultValue: "Start open. Then close your iPhone.")
        : nil
    case .awaitingOpening, .awaitingClosing:
      String(localized: "setup.waitingForShortcut", defaultValue: "Waiting for Shortcuts")
    default: nil
    }
  }

  private func beginTestWhenReady() {
    guard shouldAutoTest, readyForTest, step == .openingReady || step == .closingReady else {
      return
    }
    Task {
      try? await Task.sleep(for: .milliseconds(300))
      guard shouldAutoTest, readyForTest, step == .openingReady || step == .closingReady,
        model.operation == nil
      else { return }
      shouldAutoTest = false
      perform(.test)
    }
  }
  private func perform(_ action: SetupAction) {
    Task {
      await model.command(String(localized: "setup.updating", defaultValue: "Updating setup")) {
        model.setup = try await actions.setup(action)
      }
    }
  }
  private func dismissSetup() {
    Task {
      await model.command(String(localized: "setup.updating", defaultValue: "Updating setup")) {
        model.setup = try await actions.setup(.dismiss)
        model.showInitialSetup = false
        model.sheet = nil
      }
    }
  }
}

private struct FoldIllustration: View {
  let open: Bool
  let success: Bool
  let compact: Bool
  @State private var expanded = false
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  var body: some View {
    HStack(spacing: 4) {
      RoundedRectangle(cornerRadius: 16).fill(.primary)
      RoundedRectangle(cornerRadius: 16).fill(.primary)
        .rotation3DEffect(
          .degrees(expanded ? 0 : -70), axis: (x: 0, y: 1, z: 0),
          anchor: .leading, perspective: 0)
    }
    .frame(width: compact ? 100 : 160, height: compact ? 96 : 154)
    .overlay {
      if success {
        Image(systemName: "checkmark.circle.fill").font(.title3).foregroundStyle(.green)
          .symbolRenderingMode(.monochrome).background(.background, in: Circle())
      }
    }
    .task(id: open) {
      expanded = reduceMotion ? open : !open
      if !reduceMotion {
        await Task.yield()
        guard !Task.isCancelled else { return }
        withAnimation(.easeInOut(duration: 0.8)) { expanded = open }
      }
    }
  }
}
