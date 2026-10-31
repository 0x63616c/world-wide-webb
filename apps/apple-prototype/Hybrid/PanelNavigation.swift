import Observation
import SwiftUI

@MainActor @Observable final class PanelNavigation {
    var selection: PanelModule = .all
    var detail = false
    var showingHome = true
    var ringHidden = false
    var pendingNativeAlarmLink = false

    func returnHome() {
        pendingNativeAlarmLink = false
        detail = false
        showingHome = true
    }

    func openClassic() {
        pendingNativeAlarmLink = false
        selection = .all
        detail = false
        showingHome = false
    }

    func openNativeAlarms() {
        showingHome = false
        pendingNativeAlarmLink = false
        ringHidden = true
        selection = .alarms
        detail = true
    }
}

/// Shared above Home, Classic and every full-screen controller presentation.
struct PanelStatusOverlays: View {
    let store: LiveHomeDataSource
    let session: KioskSession
    let navigation: PanelNavigation

    var body: some View {
        ZStack {
            if !navigation.ringHidden, session.nativeAlarms.ownsRinging,
               store.hasLiveData(for: .alarms), !store.alarmsProvider.ringing(at: store.now).isEmpty {
                AlarmRingView(store: store, close: navigation.openNativeAlarms,
                    edit: navigation.openNativeAlarms, dataCaption: "")
                    .disabled(store.alarmsProvider.pending)
            }

        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .overlay(alignment: .top) { PanelNotificationOverlay() }
    }
}
