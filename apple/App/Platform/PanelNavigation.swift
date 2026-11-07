import Observation
import SwiftUI

@MainActor @Observable final class PanelNavigation {
    var selection: PanelModule = .lights
    var detail = false
    var showingHome = true
    var homeStartsInLauncher = false
    var ringHidden = false

    func returnHome() {
        homeStartsInLauncher = true
        detail = false
        showingHome = true
    }

    func openNativeAlarms() {
        showingHome = false
        ringHidden = true
        selection = .alarms
        detail = true
    }
}

/// Shared above Home and every full-screen controller presentation.
struct PanelStatusOverlays: View {
    let store: LiveHomeDataSource
    let session: PanelSession
    let navigation: PanelNavigation

    var body: some View {
        ZStack {
            if !navigation.ringHidden, session.nativeAlarms.ownsRinging,
                store.hasLiveData(for: .alarms), !store.alarmsProvider.ringing(at: store.now).isEmpty
            {
                AlarmRingView(
                    store: store, close: navigation.openNativeAlarms,
                    edit: navigation.openNativeAlarms, dataCaption: ""
                )
                .disabled(store.alarmsProvider.pending)
            }

        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .overlay(alignment: .top) { PanelNotificationOverlay() }
    }
}
