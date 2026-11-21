import FoldingData
import FoldingDomain
import StoreKit
import SwiftUI

struct SettingsScreen: View {
  @Bindable var model: FoldingPresentation
  let actions: FoldingActions
  @State private var resetConfirmation = false
  @State private var isTestFlight = false

  private var diagnosticsVisible: Bool {
    #if DEBUG
      true
    #else
      isTestFlight
    #endif
  }

  private var versionDescription: String {
    let version =
      Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "—"
    let build = Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "—"
    return "\(version) (\(build))" + (isTestFlight ? " · TestFlight" : "")
  }

  var body: some View {
    NavigationStack {
      Form {
        Section(String(localized: "settings.appearance", defaultValue: "Appearance")) {
          Picker(
            String(localized: "settings.theme", defaultValue: "Theme"),
            selection: preference(\.appearance)
          ) {
            ForEach(FoldingAppearance.allCases) { Text($0.title).tag($0) }
          }

        }
        Section {
          LabeledContent("Shortcuts") {
            if model.needsSetup {
              Text(String(localized: "settings.setupRequired", defaultValue: "Not complete"))
            } else {
              SettingsStatusValue(
                title: String(localized: "settings.setupComplete", defaultValue: "Set up"))
            }
          }
          if let last = model.lastEventAt {
            LabeledContent(String(localized: "settings.lastEvent", defaultValue: "Last event")) {
              Text(last, format: .dateTime.month(.abbreviated).day().hour().minute())
            }
          }
          Button(String(localized: "settings.runSetup", defaultValue: "Run setup again")) {
            Task {
              await model.command(
                String(localized: "setup.starting", defaultValue: "Starting setup")
              ) {
                // A rerun skips the welcome and opens on the first automation.
                _ = try await actions.setup(.restart)
                model.setup = try await actions.setup(.next)
                model.present(.setup)
              }
            }
          }
          .foregroundStyle(.blue)
          NavigationLink {
            TrackingPhoneScreen(model: model, actions: actions)
          } label: {
            LabeledContent(
              String(localized: "phone.title", defaultValue: "Tracking phone"),
              value: model.phoneName(
                for: model.analytics?.selectedDeviceID,
                fallback: model.trackingPhoneSelection?.title ?? "—"))
          }
          LabeledContent(String(localized: "sync.iCloud", defaultValue: "iCloud")) {
            if model.syncStatus?.iCloud == .available {
              SettingsStatusValue(
                title: String(localized: "sync.available", defaultValue: "Available"))
            } else {
              Text(syncTitle(model.syncStatus?.iCloud ?? .checking))
            }
          }
        } header: {
          Text(String(localized: "settings.tracking", defaultValue: "Tracking"))
        } footer: {
          Text(
            String(
              localized: "settings.icloudFooter",
              defaultValue: "Personal history syncs through iCloud when available."))
        }
        Section(String(localized: "settings.alerts", defaultValue: "Alerts")) {
          NavigationLink(String(localized: "notifications.title", defaultValue: "Notifications")) {
            NotificationSettingsScreen(model: model, actions: actions)
          }
        }
        if model.competitionJoined {
          Section(String(localized: "profile.competition", defaultValue: "Competition")) {
            NavigationLink(String(localized: "profile.yours", defaultValue: "Your Profile")) {
              YourProfileScreen(model: model, actions: actions)
            }
            NavigationLink(String(localized: "block.list", defaultValue: "Blocked players")) {
              BlockedPlayersScreen(model: model, actions: actions)
            }
          }
        }
        if model.competitionAccountExists {
          Section(String(localized: "profile.account", defaultValue: "Account")) {
            ProfileAccountActions(model: model, actions: actions)
          }
        }
        Section {
          if model.privateHistoryHealth?.requiresAttention == true {
            NavigationLink {
              HistoryRecoveryScreen(
                model: model, actions: actions,
                export: { export(.csv) }, reset: { resetConfirmation = true })
            } label: {
              Label(
                String(localized: "recovery.title", defaultValue: "History needs attention"),
                systemImage: "exclamationmark.triangle")
            }
          }
          if actions.export != nil, actions.exportURL != nil {
            Button(String(localized: "data.export", defaultValue: "Export")) {
              export(.csv)
            }
          }
          if actions.reset != nil {
            Button(
              String(localized: "data.reset", defaultValue: "Reset history"), role: .destructive
            ) { resetConfirmation = true }
            .disabled(!model.canResetHistory)
          }
        } header: {
          Text(String(localized: "settings.data", defaultValue: "Data"))
        } footer: {
          Text(
            String(
              localized: "settings.dataFooter",
              defaultValue: "Export saves a copy. Reset deletes history, scores, medals and badges."
            ))
        }
        Section {
          Toggle(
            String(localized: "settings.shareUsageData", defaultValue: "Share usage data"),
            isOn: preference(\.shareUsageData)
          )
          .tint(FoldingTint.toggle)
        } footer: {
          Text(
            String(
              localized: "settings.shareUsageDataFooter",
              defaultValue:
                "Sends fold times and app usage to help improve Folding. Not linked to your Apple Account or competition profile."
            ))
        }
        Section(String(localized: "settings.support", defaultValue: "Support")) {
          NavigationLink(String(localized: "tips.title", defaultValue: "Tip jar")) {
            if let tipJar = actions.tipJar { tipJar() }
          }.disabled(actions.tipJar == nil)
          Link(
            String(localized: "support.contact", defaultValue: "Contact"),
            destination: URL(string: "mailto:support@getfolding.app")!)
          Link(
            String(localized: "support.privacy", defaultValue: "Privacy"),
            destination: URL(string: "https://getfolding.app/privacy")!)
          if diagnosticsVisible, let load = actions.loadDiagnostics {
            NavigationLink(String(localized: "diagnostics.title", defaultValue: "Diagnostics")) {
              DiagnosticsScreen(
                load: load, clear: actions.clearDiagnostics, check: actions.checkDiagnostics)
            }
          }
          LabeledContent(
            String(localized: "settings.version", defaultValue: "Version"),
            value: versionDescription
          )
          .task {
            #if !DEBUG && !targetEnvironment(simulator)
              if let result = try? await AppTransaction.shared,
                case .verified(let transaction) = result
              {
                isTestFlight = transaction.environment == .sandbox
              }
            #endif
          }
        }
      }
      .disabled(model.operation != nil)
      .navigationTitle(String(localized: "settings.title", defaultValue: "Settings"))
      .navigationBarTitleDisplayMode(.inline)
      .tint(FoldingTint.color)
      .alert(
        String(localized: "reset.title", defaultValue: "Reset history?"),
        isPresented: $resetConfirmation
      ) {
        Button(String(localized: "action.cancel", defaultValue: "Cancel"), role: .cancel) {}
        Button(
          String(localized: "reset.confirm", defaultValue: "Reset History"), role: .destructive
        ) {
          Task { await model.requestReset(using: actions) }
        }
      } message: {
        Text(
          String(
            localized: "reset.message",
            defaultValue: "Deletes history, scores, medals and badges."))
      }
    }
    .interactiveDismissDisabled(model.operation != nil)
  }

  private func preference<Value>(_ key: WritableKeyPath<FoldingPreferences, Value>) -> Binding<
    Value
  > {
    Binding(
      get: { model.preferences[keyPath: key] },
      set: { value in
        let previous = model.preferences
        var next = previous
        next[keyPath: key] = value
        model.preferences = next
        Task {
          do {
            try await actions.savePreferences(next)
          } catch {
            if model.preferences == next { model.preferences = previous }
            model.error = String(
              localized: "error.tryAgain", defaultValue: "Something went wrong.")
          }
        }
      })
  }

  private func export(_ format: ExportChoice) {
    Task { await model.requestExport(format, using: actions) }
  }

  private func syncTitle(_ state: PrivateSyncAvailability) -> String {
    switch state {
    case .available: String(localized: "sync.available", defaultValue: "Available")
    case .localOnly: String(localized: "sync.localOnly", defaultValue: "On this iPhone")
    case .unavailable: String(localized: "sync.unavailable", defaultValue: "Unavailable")
    case .checking: "—"
    }
  }

}

/// A completed settings status: the word first, then a green checkmark, at ordinary row height.
private struct SettingsStatusValue: View {
  let title: String
  var body: some View {
    HStack(spacing: 4) {
      Text(title)
      Image(systemName: "checkmark.circle.fill").accessibilityHidden(true)
    }
    .foregroundStyle(.green)
  }
}

private struct HistoryRecoveryScreen: View {
  @Bindable var model: FoldingPresentation
  let actions: FoldingActions
  let export: () -> Void
  let reset: () -> Void

  var body: some View {
    Form {
      Section {
        Text(
          String(
            localized: "recovery.explanation",
            defaultValue: "Some synced history couldn’t be verified."))
      }
      Section {
        if actions.export != nil, actions.exportURL != nil {
          Button(String(localized: "data.export", defaultValue: "Export"), action: export)
        }
        if actions.reset != nil {
          Button(
            String(localized: "data.reset", defaultValue: "Reset history"), role: .destructive,
            action: reset
          ).disabled(!model.canResetHistory)
        }
        Link(
          String(localized: "leaderboard.appeal", defaultValue: "Contact support"),
          destination: URL(string: "mailto:support@getfolding.app")!)
      }
    }
    .disabled(model.operation != nil)
    .navigationTitle(String(localized: "recovery.title", defaultValue: "History needs attention"))
    .navigationBarTitleDisplayMode(.inline)
  }
}
