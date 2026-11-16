import FoldingData
import FoldingDomain
import SwiftUI

struct NotificationSettingsScreen: View {
  @Bindable var model: FoldingPresentation
  let actions: FoldingActions
  var body: some View {
    Form {
      if model.notificationAuthorization == .denied {
        Section {
          Label(
            String(localized: "notifications.disabled", defaultValue: "Notifications off"),
            systemImage: "bell.slash")
          if let open = actions.openNotificationSettings {
            Button(
              String(localized: "notifications.openSettings", defaultValue: "Open Settings"),
              action: open)
          }
        }
      }
      Section {
        Toggle(
          String(localized: "notifications.daily", defaultValue: "Daily limit reached"),
          isOn: preference(\.dailyLimit)
        )
        .tint(.black)
        if model.notificationPreferences.dailyLimit {
          Stepper(value: dailyThreshold, in: 1...100_000, step: 10) {
            LabeledContent(
              String(localized: "settings.dailyLimit", defaultValue: "Daily limit"),
              value: model.preferences.dailyLimit.formatted())
          }
        }
        Toggle(
          String(localized: "notifications.badges", defaultValue: "Badges earned"),
          isOn: preference(\.badgesEarned)
        ).disabled(!model.competitionJoined)
      }.disabled(actions.saveNotifications == nil || model.operation != nil)
    }
    .navigationTitle(String(localized: "notifications.title", defaultValue: "Notifications"))
    .navigationBarTitleDisplayMode(.inline)
  }
  private func preference<Value>(_ key: WritableKeyPath<NotificationPreferences, Value>) -> Binding<
    Value
  > {
    Binding(
      get: { model.notificationPreferences[keyPath: key] },
      set: { value in
        guard let save = actions.saveNotifications else { return }
        var next = model.notificationPreferences
        next[keyPath: key] = value
        Task {
          await model.command(String(localized: "settings.saving", defaultValue: "Saving")) {
            model.notificationPreferences = try await save(next)
          }
        }
      })
  }

  private var dailyThreshold: Binding<Int> {
    Binding(
      get: { model.preferences.dailyLimit },
      set: { value in
        var next = model.preferences
        next.dailyLimit = value
        Task {
          await model.command(String(localized: "settings.saving", defaultValue: "Saving")) {
            try await actions.savePreferences(next)
          }
        }
      })
  }
}
