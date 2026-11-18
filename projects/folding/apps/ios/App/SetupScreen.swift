import AVFoundation
import FoldingData
import FoldingDomain
import SwiftUI

enum HingePosture: Equatable { case closed, open }

/// Guided setup: add each Shortcuts automation, then prove it with one real fold.
/// The persisted `SetupStep` machine owns progress; this view only presents it.
struct SetupScreen: View {
  @Bindable var model: FoldingPresentation
  let actions: FoldingActions
  @State private var hinge: HingePosture?

  var body: some View {
    if #available(iOS 27.1, *) {
      SetupFlow(model: model, actions: actions, hinge: hinge)
        .onHingeChange { _, context in
          guard let status = context.hinge?.status else {
            hinge = nil
            return
          }
          hinge = status == .closed ? .closed : .open
        }
    } else {
      SetupFlow(model: model, actions: actions, hinge: nil)
    }
  }
}

private enum SetupPhase: Equatable {
  case welcome, add, test, passed, retry, done
}

private struct SetupFlow: View {
  @Bindable var model: FoldingPresentation
  let actions: FoldingActions
  let hinge: HingePosture?
  /// The hinge reached the test's start posture during this step.
  @State private var reachedStart = false
  /// A test passed while this screen was open, so the finish earns a celebration.
  @State private var celebrate = false
  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  private var step: SetupStep { model.setup?.step ?? .welcome }
  private var closing: Bool {
    [.closingInstructions, .closingReady, .awaitingClosing, .closingPassed, .closingRetry]
      .contains(step)
  }
  private var phase: SetupPhase {
    switch step {
    case .welcome: .welcome
    case .openingInstructions, .closingInstructions: .add
    case .openingReady, .awaitingOpening, .closingReady, .awaitingClosing: .test
    case .openingPassed, .closingPassed: .passed
    case .openingRetry, .closingRetry: .retry
    case .complete: .done
    }
  }
  /// Tests passed so far: drives the two progress capsules.
  private var passedCount: Int {
    switch step {
    case .welcome, .openingInstructions, .openingReady, .awaitingOpening, .openingRetry: 0
    case .openingPassed, .closingInstructions, .closingReady, .awaitingClosing, .closingRetry: 1
    case .closingPassed, .complete: 2
    }
  }
  /// The posture the fold under test starts from.
  private var startPosture: HingePosture { closing ? .open : .closed }
  private var busy: Bool { model.operation != nil }

  var body: some View {
    NavigationStack {
      GeometryReader { geometry in
        ScrollView {
          VStack(spacing: 0) {
            Spacer(minLength: 24)
            hero
              .frame(height: 220)
              .padding(.bottom, 32)
            Text(title)
              .font(.title.bold())
              .multilineTextAlignment(.center)
              .contentTransition(.opacity)
            if let subtitle {
              HStack(spacing: 8) {
                if step.isWaiting {
                  Image(systemName: "circle.fill")
                    .font(.system(size: 7))
                    .symbolEffect(.pulse, options: .repeat(.continuous), isActive: !reduceMotion)
                }
                Text(subtitle)
              }
              .font(.body)
              .foregroundStyle(.secondary)
              .multilineTextAlignment(.center)
              .padding(.top, 8)
              .transition(.opacity)
            }
            Spacer(minLength: 32)
            buttons
          }
          .frame(maxWidth: 440)
          .padding(.horizontal, 24)
          .padding(.bottom, 16)
          .frame(maxWidth: .infinity, minHeight: geometry.size.height)
        }
        .scrollBounceBehavior(.basedOnSize)
      }
      .background(FoldingSurface.background.ignoresSafeArea())
      .toolbar {
        if phase != .welcome {
          ToolbarItem(placement: .principal) { SetupProgressBar(passed: passedCount) }
        }
        if !model.showInitialSetup && phase != .done {
          ToolbarItem(placement: .cancellationAction) {
            Button(String(localized: "action.cancel", defaultValue: "Cancel"), systemImage: "xmark")
            {
              dismissSetup()
            }
            .disabled(busy)
          }
        }
      }
      .toolbarBackground(.hidden, for: .navigationBar)
      .animation(reduceMotion ? nil : .smooth(duration: 0.4), value: step)
      .animation(reduceMotion ? nil : .smooth(duration: 0.3), value: hinge)
    }
    .interactiveDismissDisabled()
    .sensoryFeedback(.success, trigger: passedCount) { old, new in new > old }
    .sensoryFeedback(.warning, trigger: phase) { _, new in new == .retry }
    .onChange(of: hinge, initial: true) { _, posture in
      if posture == startPosture { reachedStart = true }
    }
    .onChange(of: step, initial: true) { _, next in
      reachedStart = hinge == startPosture
      if next == .complete && celebrate { SetupFeedback.complete() }
      if next == .openingPassed || next == .closingPassed {
        celebrate = true
        SetupFeedback.pass()
        AccessibilityNotification.Announcement(
          String(localized: "setup.testPassed", defaultValue: "Test passed")
        ).post()
        Task {
          try? await Task.sleep(for: .milliseconds(1400))
          if model.setup?.step == next { perform([.next]) }
        }
      } else if next == .openingRetry || next == .closingRetry {
        AccessibilityNotification.Announcement(title).post()
      }
    }
  }

  // MARK: Hero

  @ViewBuilder private var hero: some View {
    if phase == .add || phase == .retry {
      AutomationRecipe(closing: closing)
        .transition(.blurReplace)
    } else {
      // One phone instance across phases so the fold animates continuously.
      FoldPhone(motion: phoneMotion, success: phase == .passed || phase == .done)
        .background {
          if phase == .done && celebrate && !reduceMotion { CelebrationBurst() }
        }
        .transition(.blurReplace)
        .accessibilityHidden(true)
    }
  }

  private var phoneMotion: FoldPhone.Motion {
    switch phase {
    case .welcome: .demo(from: .closed)
    case .passed: .hold(closing ? .closed : .open)
    case .done: .hold(hinge ?? .open)
    default: testMotion
    }
  }

  private var testMotion: FoldPhone.Motion {
    guard let hinge else { return .demo(from: startPosture) }
    // Already in the start posture: nudge toward the fold being tested.
    return hinge == startPosture ? .nudge(from: hinge) : .hold(hinge)
  }

  // MARK: Copy

  private var title: String {
    switch phase {
    case .welcome: String(localized: "setup.welcome", defaultValue: "Welcome to Folding")
    case .add:
      closing
        ? String(localized: "setup.closingAutomation", defaultValue: "Track closing")
        : String(localized: "setup.openingAutomation", defaultValue: "Track opening")
    case .test: testTitle
    case .passed: String(localized: "setup.testPassed", defaultValue: "Test passed")
    case .retry: String(localized: "setup.missed", defaultValue: "Didn’t catch that")
    case .done: String(localized: "setup.complete", defaultValue: "You're set")
    }
  }

  private var testTitle: String {
    guard let hinge else {
      return closing
        ? String(localized: "setup.openThenClose", defaultValue: "Open, then close")
        : String(localized: "setup.closeThenOpen", defaultValue: "Close, then open")
    }
    if hinge != startPosture && reachedStart {
      return String(localized: "setup.checking", defaultValue: "Checking…")
    }
    if hinge == startPosture {
      return closing
        ? String(localized: "setup.nowClose", defaultValue: "Now close it")
        : String(localized: "setup.nowOpen", defaultValue: "Now open it")
    }
    return closing
      ? String(localized: "setup.openDevice", defaultValue: "Open your iPhone")
      : String(localized: "setup.closeDevice", defaultValue: "Close your iPhone")
  }

  private var subtitle: String? {
    switch phase {
    case .welcome: String(localized: "setup.tagline", defaultValue: "Count every fold.")
    case .add:
      String(localized: "setup.addInShortcuts", defaultValue: "Add this automation in Shortcuts.")
    case .test where step.isWaiting:
      String(localized: "setup.waitingForShortcut", defaultValue: "Waiting for Shortcuts")
    case .retry:
      String(localized: "setup.checkRecipe", defaultValue: "Check it matches, then try again.")
    default: nil
    }
  }

  // MARK: Buttons

  @ViewBuilder private var buttons: some View {
    VStack(spacing: 12) {
      switch phase {
      case .welcome:
        primary(String(localized: "setup.getStarted", defaultValue: "Get started")) {
          perform([.next])
        }
      case .add:
        primary(String(localized: "setup.openShortcuts", defaultValue: "Open Shortcuts")) {
          actions.openShortcuts?()
        }
        secondary(String(localized: "setup.addedAutomation", defaultValue: "I've added it")) {
          perform([.next, .test])
        }
      case .test:
        if !step.isWaiting {
          primary(String(localized: "setup.startTest", defaultValue: "Start test")) {
            perform([.test])
          }
        }
        shortcutsLink
      case .passed:
        EmptyView()
      case .retry:
        primary(String(localized: "setup.tryAgain", defaultValue: "Try again")) {
          perform([.retry, .test])
        }
        shortcutsLink
      case .done:
        primary(String(localized: "action.done", defaultValue: "Done")) { dismissSetup() }
      }
    }
    .frame(minHeight: 120, alignment: .bottom)
    // Done stays live: the final step lands while its own command finishes.
    .disabled(busy && phase != .done)
  }

  private func primary(_ label: String, action: @escaping () -> Void) -> some View {
    Button(action: action) {
      Text(label).font(.headline).frame(maxWidth: .infinity, minHeight: 34)
    }
    .buttonStyle(.borderedProminent)
    .controlSize(.large)
    .foregroundStyle(FoldingTint.onTint)
  }

  private func secondary(_ label: String, action: @escaping () -> Void) -> some View {
    Button(action: action) {
      Text(label).font(.headline).frame(maxWidth: .infinity, minHeight: 34)
    }
    .buttonStyle(.bordered)
    .controlSize(.large)
  }

  @ViewBuilder private var shortcutsLink: some View {
    if let open = actions.openShortcuts {
      Button(String(localized: "setup.openShortcuts", defaultValue: "Open Shortcuts"), action: open)
        .font(.subheadline.weight(.medium))
        .foregroundStyle(.secondary)
        .padding(.vertical, 8)
    }
  }

  // MARK: Commands

  private func perform(_ steps: [SetupAction]) {
    Task {
      await model.command(String(localized: "setup.updating", defaultValue: "Updating setup")) {
        for action in steps { model.setup = try await actions.setup(action) }
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

// MARK: - Celebration

/// Sound and haptics for a passed test and for finishing setup. Sounds use the ambient
/// category, so they mix with other audio and stay quiet when the ringer is off.
@MainActor private enum SetupFeedback {
  private static var players: [String: AVAudioPlayer] = [:]

  static func pass() { play("setup-pass") }

  static func complete() {
    play("setup-complete")
    // Taps land on the chime's notes, ending in a success buzz.
    Task {
      for style in [UIImpactFeedbackGenerator.FeedbackStyle.light, .light, .medium] {
        UIImpactFeedbackGenerator(style: style).impactOccurred()
        try? await Task.sleep(for: .milliseconds(90))
      }
      UINotificationFeedbackGenerator().notificationOccurred(.success)
    }
  }

  private static func play(_ name: String) {
    guard let url = Bundle.main.url(forResource: name, withExtension: "caf") else { return }
    try? AVAudioSession.sharedInstance().setCategory(.ambient)
    guard let player = players[name] ?? (try? AVAudioPlayer(contentsOf: url)) else { return }
    players[name] = player
    player.currentTime = 0
    player.play()
  }
}

/// A one-off burst of dots and a ring behind the finished phone.
private struct CelebrationBurst: View {
  @State private var fired = false

  var body: some View {
    ZStack {
      Circle()
        .stroke(.green, lineWidth: fired ? 1 : 8)
        .frame(width: 120, height: 120)
        .scaleEffect(fired ? 2.1 : 0.5)
        .opacity(fired ? 0 : 0.7)
      ForEach(0..<14, id: \.self) { index in
        let angle = Double(index) / 14 * 2 * .pi
        let distance: CGFloat = index.isMultiple(of: 2) ? 150 : 118
        Circle()
          .fill(index.isMultiple(of: 3) ? AnyShapeStyle(FoldingTint.color) : AnyShapeStyle(.green))
          .frame(width: index.isMultiple(of: 2) ? 9 : 6)
          .offset(x: fired ? cos(angle) * distance : 0, y: fired ? sin(angle) * distance : 0)
          .scaleEffect(fired ? 0.4 : 1)
          .opacity(fired ? 0 : 1)
      }
    }
    .onAppear { withAnimation(.easeOut(duration: 1.1)) { fired = true } }
    .allowsHitTesting(false)
  }
}

// MARK: - Progress

private struct SetupProgressBar: View {
  let passed: Int
  var body: some View {
    HStack(spacing: 6) {
      ForEach(0..<2, id: \.self) { index in
        Capsule()
          .fill(index < passed ? AnyShapeStyle(FoldingTint.color) : AnyShapeStyle(.quaternary))
          .frame(width: 28, height: 6)
      }
    }
    .animation(.smooth, value: passed)
    .accessibilityHidden(true)
  }
}

// MARK: - Shortcuts recipe

/// The automation exactly as it should read in Shortcuts.
private struct AutomationRecipe: View {
  let closing: Bool

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      row {
        IconTile(fill: Color(.systemGray)) {
          Image(systemName: "iphone.gen3")
            .font(.system(size: 17, weight: .semibold)).foregroundStyle(.white)
        }
      } label: {
        Text(
          closing
            ? String(localized: "setup.triggerClosed", defaultValue: "Display → Closed")
            : String(localized: "setup.triggerOpen", defaultValue: "Display → Open")
        )
      }
      Rectangle()
        .fill(.quaternary)
        .frame(width: 2, height: 14)
        .padding(.leading, 16 + 17)
      row {
        IconTile(
          fill: LinearGradient(
            colors: [Color(red: 0.118, green: 0.118, blue: 0.129), .black], startPoint: .top,
            endPoint: .bottom)
        ) {
          FoldingMark().fill(.white)
        }
      } label: {
        Text(
          closing
            ? String(localized: "intent.recordClosing.title", defaultValue: "Log iPhone Closed")
            : String(localized: "intent.recordOpening.title", defaultValue: "Log iPhone Opened")
        )
        .fontWeight(.semibold)
      }
      Divider().padding(.vertical, 12).padding(.leading, 16)
      HStack(spacing: 10) {
        Image(systemName: "checkmark.circle.fill")
          .font(.title3)
          .foregroundStyle(FoldingTint.color)
        Text(String(localized: "setup.runImmediately", defaultValue: "Run Immediately"))
          .font(.subheadline.weight(.medium))
        Spacer(minLength: 0)
      }
      .padding(.horizontal, 16)
    }
    .padding(.vertical, 16)
    .frame(maxWidth: 360)
    .background(FoldingSurface.card, in: .rect(cornerRadius: FoldingShape.cornerRadius))
    .accessibilityElement(children: .combine)
  }

  private func row(@ViewBuilder icon: () -> some View, @ViewBuilder label: () -> some View)
    -> some View
  {
    HStack(spacing: 12) {
      icon()
      label().font(.body)
      Spacer(minLength: 0)
    }
    .padding(.horizontal, 16)
  }
}

private struct IconTile<Fill: ShapeStyle, Content: View>: View {
  let fill: Fill
  @ViewBuilder let content: Content
  var body: some View {
    RoundedRectangle(cornerRadius: 9, style: .continuous)
      .fill(fill)
      .frame(width: 36, height: 36)
      .overlay { content }
  }
}

/// The Folding app icon's two panels (AppIcon.icon front/back layers, 1024-unit artboard).
private struct FoldingMark: Shape {
  func path(in rect: CGRect) -> Path {
    let s = min(rect.width, rect.height) / 1024
    let o = CGPoint(x: rect.midX - 512 * s, y: rect.midY - 512 * s)
    func p(_ x: CGFloat, _ y: CGFloat) -> CGPoint { CGPoint(x: o.x + x * s, y: o.y + y * s) }
    var path = Path()
    // Front (left) panel.
    path.move(to: p(187, 287))
    path.addQuadCurve(to: p(226.85, 261.65), control: p(187, 243))
    path.addLine(to: p(459.15, 370.35))
    path.addQuadCurve(to: p(499, 433), control: p(499, 389))
    path.addLine(to: p(499, 742))
    path.addQuadCurve(to: p(458.9, 767.88), control: p(499, 786))
    path.addLine(to: p(227.1, 663.12))
    path.addQuadCurve(to: p(187, 601), control: p(187, 645))
    path.closeSubpath()
    // Back (right) panel.
    path.move(to: p(837, 601))
    path.addQuadCurve(to: p(796.9, 663.12), control: p(837, 645))
    path.addLine(to: p(565.1, 767.88))
    path.addQuadCurve(to: p(525, 742), control: p(525, 786))
    path.addLine(to: p(525, 433))
    path.addQuadCurve(to: p(564.85, 370.35), control: p(525, 389))
    path.addLine(to: p(797.15, 261.65))
    path.addQuadCurve(to: p(837, 287), control: p(837, 243))
    path.closeSubpath()
    return path
  }
}

// MARK: - Phone illustration

/// A two-panel phone that folds like the real hinge.
private struct FoldPhone: View {
  enum Motion: Equatable {
    /// Rest in a posture.
    case hold(HingePosture)
    /// Show the whole fold from a posture and back, on a loop.
    case demo(from: HingePosture)
    /// Rest in a posture with a small hint toward the other one.
    case nudge(from: HingePosture)
  }

  let motion: Motion
  let success: Bool
  @State private var openness: Double
  /// How far the drawing is shifted to centre a closed phone (0 open, 1 closed).
  /// It lags the fold, so the right panel holds still while the left one swings.
  @State private var shift: Double

  init(motion: Motion, success: Bool) {
    self.motion = motion
    self.success = success
    // Start where the motion starts so a new phone never animates in from closed.
    switch motion {
    case .hold(let posture), .demo(let posture), .nudge(let posture):
      _openness = State(initialValue: posture == .open ? 1 : 0)
      _shift = State(initialValue: posture == .open ? 0 : 1)
    }
  }
  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  private let panel = CGSize(width: 76, height: 148)
  private let gap: CGFloat = 4
  private var half: CGFloat { (panel.width + gap) / 2 }

  var body: some View {
    let fold = 1 - openness
    // The left panel swings out from behind the right one.
    HStack(spacing: gap) {
      screen
        .rotation3DEffect(
          .degrees(178 * fold), axis: (x: 0, y: 1, z: 0), anchor: .trailing,
          anchorZ: 0, perspective: 0.35
        )
        .opacity(fold > 0.98 ? 0 : 1)
      screen
    }
    .frame(width: panel.width * 2 + gap, height: panel.height)
    .offset(x: -half * shift)
    .overlay(alignment: .center) {
      if success {
        Image(systemName: "checkmark.circle.fill")
          .font(.system(size: 54, weight: .semibold))
          .symbolRenderingMode(.palette)
          .foregroundStyle(FoldingTint.onTint, .green)
          .offset(x: half * (1 - openness) - half * shift)
          .transition(.scale(scale: 0.2).combined(with: .opacity))
      }
    }
    .animation(.spring(duration: 0.45, bounce: 0.45), value: success)
    .task(id: motion) { await run() }
  }

  private var screen: some View {
    RoundedRectangle(cornerRadius: 16, style: .continuous)
      .fill(FoldingTint.color)
      .overlay {
        RoundedRectangle(cornerRadius: 11, style: .continuous)
          .fill(FoldingTint.onTint.opacity(0.14))
          .padding(5)
      }
      .frame(width: panel.width, height: panel.height)
  }

  private func value(_ posture: HingePosture) -> Double { posture == .open ? 1 : 0 }

  /// Folds to `target` with the right panel held still, then glides back to centre.
  private func set(_ target: Double, _ animation: Animation, settle: Duration = .zero) async {
    let rest: Double? = target == 0 ? 1 : target == 1 ? 0 : nil
    guard !reduceMotion else {
      openness = target
      if let rest { shift = rest }
      return
    }
    withAnimation(animation) { openness = target }
    guard let rest, shift != rest else { return }
    try? await Task.sleep(for: settle)
    guard !Task.isCancelled else { return }
    withAnimation(.smooth(duration: 0.45)) { shift = rest }
  }

  private func run() async {
    switch motion {
    case .hold(let posture):
      await set(value(posture), .spring(duration: 0.6, bounce: 0.2), settle: .milliseconds(450))
    case .demo(let start):
      let from = value(start)
      await set(from, .spring(duration: 0.5), settle: .milliseconds(400))
      guard !reduceMotion else { return }
      while !Task.isCancelled {
        try? await Task.sleep(for: .milliseconds(900))
        guard !Task.isCancelled else { return }
        await set(1 - from, .spring(duration: 0.9, bounce: 0.15), settle: .milliseconds(650))
        try? await Task.sleep(for: .milliseconds(1100))
        guard !Task.isCancelled else { return }
        await set(from, .spring(duration: 0.9, bounce: 0.15), settle: .milliseconds(650))
      }
    case .nudge(let start):
      let from = value(start)
      await set(from, .spring(duration: 0.5), settle: .milliseconds(400))
      guard !reduceMotion else { return }
      let hint = from == 0 ? 0.22 : 0.78
      while !Task.isCancelled {
        try? await Task.sleep(for: .milliseconds(700))
        guard !Task.isCancelled else { return }
        await set(hint, .spring(duration: 0.35, bounce: 0.3))
        try? await Task.sleep(for: .milliseconds(380))
        guard !Task.isCancelled else { return }
        await set(from, .spring(duration: 0.45, bounce: 0.35))
      }
    }
  }
}
