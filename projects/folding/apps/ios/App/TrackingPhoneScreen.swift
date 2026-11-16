import FoldingData
import FoldingDomain
import SwiftUI

struct TrackingPhoneScreen: View {
  @Bindable var model: FoldingPresentation
  let actions: FoldingActions
  @State private var confirming = false
  @State private var editingDeviceID: UUID?
  @State private var nameDraft = ""
  @State private var renaming = false

  var body: some View {
    Form {
      Section(String(localized: "phone.personalHistory", defaultValue: "Personal history")) {
        if let selection = model.trackingPhoneSelection {
          Label(
            model.phoneName(
              for: model.analytics?.selectedDeviceID, fallback: selection.title),
            systemImage: selection == .thisPhone
              ? "iphone.gen3" : "iphone.gen3.radiowaves.left.and.right")
          if selection == .thisPhone,
            model.phoneName(for: model.localDeviceID, fallback: "") != ""
          {
            Text(selection.title).font(.caption).foregroundStyle(.secondary)
          }
          if let selectedID = model.analytics?.selectedDeviceID {
            renameButton(for: selectedID)
          }
          if selection != .thisPhone || model.publicTrackingPhone == .anotherPhone,
            actions.useThisPhone != nil
          {
            Button(String(localized: "phone.useThis", defaultValue: "Use this iPhone")) {
              confirming = true
            }
            .disabled(model.operation != nil)
          }
        } else {
          ProgressView()
        }
      }
      if model.trackingPhoneSelection != .thisPhone, let localID = model.localDeviceID {
        Section {
          LabeledContent(
            String(localized: "phone.thisPhone", defaultValue: "This iPhone"),
            value: model.phoneName(for: localID, fallback: ""))
          renameButton(for: localID)
        }
      }
      if let selection = model.publicTrackingPhone {
        Section(String(localized: "tab.leaderboard", defaultValue: "Leaderboard")) {
          Label(
            selection == .thisPhone
              ? model.phoneName(for: model.localDeviceID, fallback: selection.title)
              : selection.title,
            systemImage: "trophy")
        }
      }
    }
    .navigationTitle(String(localized: "phone.title", defaultValue: "Tracking phone"))
    .navigationBarTitleDisplayMode(.inline)
    .alert(String(localized: "phone.rename", defaultValue: "Name phone"), isPresented: $renaming) {
      TextField(String(localized: "phone.name", defaultValue: "Phone name"), text: $nameDraft)
        .onChange(of: nameDraft) { _, value in nameDraft = String(value.prefix(40)) }
      Button(String(localized: "action.save", defaultValue: "Save")) {
        guard let deviceID = editingDeviceID else { return }
        var next = model.preferences
        let name = nameDraft.trimmingCharacters(in: .whitespacesAndNewlines)
        next.phoneNames[deviceID.uuidString.lowercased()] = name.isEmpty ? nil : name
        Task {
          await model.command(String(localized: "settings.saving", defaultValue: "Saving")) {
            try await actions.savePreferences(next)
          }
        }
      }
      Button(String(localized: "action.cancel", defaultValue: "Cancel"), role: .cancel) {}
    } message: {
      Text(String(localized: "phone.nameLocal", defaultValue: "Names are saved on this iPhone."))
    }
    .navigationDestination(isPresented: $confirming) {
      TrackingPhoneConfirmation(model: model, actions: actions)
    }
  }
  private func renameButton(for deviceID: UUID) -> some View {
    Button(String(localized: "phone.rename", defaultValue: "Name phone")) {
      editingDeviceID = deviceID
      nameDraft = model.phoneName(for: deviceID, fallback: "")
      renaming = true
    }.disabled(model.operation != nil)
  }
}

private struct TrackingPhoneConfirmation: View {
  @Bindable var model: FoldingPresentation
  let actions: FoldingActions
  @Environment(\.dismiss) private var dismiss

  var body: some View {
    Form {
      Section {
        if model.publicTrackingPhone == .anotherPhone {
          Text(
            String(
              localized: "phone.publicTransferEffect",
              defaultValue:
                "Moves leaderboard tracking here. Later uploads from your other iPhone won’t count."
            ))
        }
        Text(
          String(
            localized: "phone.transferEffect",
            defaultValue: "Folds not yet received from other phones will appear only in exports."))
        Button(String(localized: "phone.useThis", defaultValue: "Use this iPhone")) {
          Task {
            await model.selectThisPhone(using: actions)
          }
        }
        .disabled(
          model.operation != nil || actions.useThisPhone == nil
            || (model.trackingPhoneSelection == .thisPhone
              && model.publicTrackingPhone != .anotherPhone)
        )
      }
    }
    .navigationTitle(String(localized: "phone.confirmTitle", defaultValue: "Use this iPhone?"))
    .navigationBarTitleDisplayMode(.inline)
    .toolbar {
      ToolbarItem(placement: .cancellationAction) {
        Button(String(localized: "action.cancel", defaultValue: "Cancel")) { dismiss() }
          .disabled(model.operation != nil)
      }
    }
    .onChange(of: model.operation) { _, operation in
      if operation == nil && model.trackingPhoneSelection == .thisPhone
        && model.publicTrackingPhone != .anotherPhone
      {
        dismiss()
      }
    }
    .onChange(of: model.trackingPhoneSelection) { _, selection in
      if selection == .thisPhone && model.publicTrackingPhone != .anotherPhone { dismiss() }
    }
  }
}
