import PanelKit
import SwiftUI

/// One touch-first PIN surface for private pages, command confirmation and settings.
/// No text field or software keyboard; entered digits are never displayed.
struct PanelPINEntry: View {
    let title: String
    var prompt: String? = nil
    var symbol = "lock.fill"
    var notice: String?
    var busy = false
    let submit: @MainActor (String) async -> String?
    @Environment(\.scenePhase) private var phase
    @State private var digits = ""
    @State private var checking = false
    @State private var message: String?
    @State private var submission: Task<Void, Never>?

    var body: some View {
        VStack(spacing: 24) {
            Image(systemName: symbol).font(.system(size: 28, weight: .medium))
                .foregroundStyle(.secondary).frame(height: 40).accessibilityHidden(true)
            VStack(spacing: 8) {
                Text(title).font(.largeTitle.weight(.semibold))
                if let prompt { Text(prompt).font(.title3).foregroundStyle(.secondary) }
            }
            HStack(spacing: 18) {
                ForEach(0..<6) { index in
                    Circle().fill(index < digits.count ? Color.primary : .clear)
                        .overlay { Circle().strokeBorder(.primary.opacity(0.45), lineWidth: 1.5) }
                        .frame(width: 13, height: 13)
                }
            }.frame(height: 26)
                .animation(.easeOut(duration: 0.12), value: digits.count)
                .accessibilityElement(children: .ignore)
                .accessibilityLabel("PIN").accessibilityValue("\(digits.count) of 6 digits")
                .accessibilityIdentifier("pin-progress")
            ZStack {
                if checking || busy {
                    ProgressView().controlSize(.small)
                } else if let message = message ?? notice {
                    Text(message).font(.callout).foregroundStyle(.secondary)
                        .multilineTextAlignment(.center).fixedSize(horizontal: false, vertical: true)
                }
            }.frame(minHeight: 24).accessibilityIdentifier("pin-message")
            GlassEffectContainer(spacing: 14) {
                Grid(horizontalSpacing: 18, verticalSpacing: 14) {
                    ForEach(0..<3) { row in
                        GridRow {
                            ForEach(1..<4) { column in digitKey(row * 3 + column) }
                        }
                    }
                    GridRow {
                        Color.clear.frame(width: 80, height: 80).accessibilityHidden(true)
                        digitKey(0)
                        Button {
                            if !digits.isEmpty { digits.removeLast() }
                            message = nil
                        } label: {
                            Image(systemName: "delete.left").font(.title2).frame(width: 80, height: 80)
                                .contentShape(.rect)
                        }.buttonStyle(.plain).disabled(digits.isEmpty)
                            .accessibilityLabel("Delete digit").accessibilityIdentifier("pin-delete")
                    }
                }
            }.disabled(checking || busy)
        }.frame(maxWidth: .infinity, maxHeight: .infinity)
            .padding(24)
            .onDisappear { reset() }
            .onChange(of: phase) { _, value in if value != .active { reset() } }
            .onAppear {
                AccessibilityNotification.Announcement(
                    [title, prompt ?? "Enter PIN", notice].compactMap { $0 }.joined(separator: ". ")
                ).post()
            }
            .onChange(of: message) { _, value in
                if let value { AccessibilityNotification.Announcement(value).post() }
            }
    }
    private func digitKey(_ number: Int) -> some View {
        Button {
            append(number)
        } label: {
            Text(String(number)).font(.system(size: 32, weight: .regular, design: .rounded))
                .frame(width: 80, height: 80).contentShape(.circle)
        }.buttonStyle(.glass).buttonBorderShape(.circle)
            .accessibilityLabel(String(number)).accessibilityIdentifier("pin-digit-\(number)")
    }
    private func append(_ number: Int) {
        guard !checking, !busy, digits.count < 6 else { return }
        message = nil
        digits += String(number)
        guard digits.count == 6 else { return }
        let entered = digits
        checking = true
        submission = Task { @MainActor in
            let result = await submit(entered)
            guard !Task.isCancelled else { return }
            digits = ""
            checking = false
            message = result
        }
    }
    private func reset() {
        submission?.cancel()
        submission = nil
        digits = ""
        checking = false
        message = nil
    }
}

struct PanelPINChangePage: View {
    let api: PanelPINAPI
    private enum Stage { case current, new, confirm, done }
    @State private var stage = Stage.current
    @State private var current = ""
    @State private var replacement = ""
    @State private var stageError: String?
    @State private var saving = false
    @Environment(\.scenePhase) private var phase

    var body: some View {
        Group {
            if stage == .done {
                ContentUnavailableView(
                    "PIN changed", systemImage: "checkmark.circle",
                    description: Text("Your panel PIN is up to date.")
                )
                .accessibilityIdentifier("pin-change-complete")
                .onAppear { AccessibilityNotification.Announcement("PIN changed").post() }
            } else {
                VStack(spacing: 0) {
                    PanelPINEntry(title: "Change PIN", prompt: prompt, notice: stageError, submit: accept)
                        .id(stage)
                    if stage == .confirm {
                        Button("Choose a different PIN") {
                            replacement = ""
                            stage = .new
                        }
                        .buttonStyle(.glass).controlSize(.large).padding(.bottom, 24)
                        .disabled(saving)
                    }
                }
            }
        }.navigationTitle("Panel PIN").frame(maxWidth: .infinity, maxHeight: .infinity)
            .onDisappear { clear() }
            .onChange(of: phase) { _, value in
                if value != .active {
                    clear()
                    stage = .current
                }
            }
    }
    private var prompt: String {
        switch stage {
        case .current: "Enter current PIN"
        case .new: "Choose a new PIN"
        case .confirm: "Confirm new PIN"
        case .done: ""
        }
    }
    @MainActor private func accept(_ pin: String) async -> String? {
        stageError = nil
        do {
            switch stage {
            case .current:
                guard try await api.verify(pin) else { return "Incorrect PIN. Try again." }
                try Task.checkCancellation()
                current = pin
                stage = .new
            case .new:
                replacement = pin
                stage = .confirm
            case .confirm:
                guard pin == replacement else { return "PINs don’t match. Try again." }
                saving = true
                defer { saving = false }
                try await api.change(current: current, replacement: replacement)
                try Task.checkCancellation()
                clear()
                stage = .done
            case .done: break
            }
            return nil
        } catch is CancellationError { return nil } catch PanelPINAPI.Failure.incorrectCurrentPIN {
            clear()
            stage = .current
            stageError = "The current PIN changed. Try again."
            return nil
        } catch { return "Couldn’t connect. Try again." }
    }
    private func clear() {
        current = ""
        replacement = ""
    }
}
