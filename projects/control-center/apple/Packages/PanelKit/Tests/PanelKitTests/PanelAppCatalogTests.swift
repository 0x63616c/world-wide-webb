import Testing

@testable import PanelKit

@Suite struct PanelAppCatalogTests {
    @Test func requestedLauncherOrderAndSettingsLast() {
        let apps = PanelAppCatalog.standard.apps
        #expect(Array(apps.prefix(5).map(\.id)) == ["calendar", "weather", "lights", "climate", "car"])
        #expect(Array(apps.dropFirst(5).prefix(3).map(\.id)) == ["wifi", "music", "timer"])
        #expect(apps.last?.id == "settings")
        #expect(PanelAppCatalog.standard.app(id: "cameras") == nil)
        #expect(PanelAppCatalog.standard.app(id: "clock") == nil)
        #expect(PanelAppCatalog.standard.app(id: "photos") == nil)
        #expect(apps.first { $0.id == "booth" }?.route == .photoBooth)
    }
    @Test func everyFeatureHasExactlyOneApp() {
        let routes = PanelAppCatalog.standard.apps.compactMap { app -> PanelAppFeature? in
            if case .feature(let feature) = app.route { return feature }
            return nil
        }
        #expect(Set(routes) == Set(PanelAppFeature.allCases))
        #expect(routes.count == PanelAppFeature.allCases.count)
    }
    @Test func rejectsDuplicateIdentity() throws {
        let app = try #require(PanelAppCatalog.standard.apps.first)
        #expect(throws: PanelAppCatalog.ValidationError.duplicateID(app.id)) {
            try PanelAppCatalog(apps: [app, app])
        }
    }
    @Test func rejectsMissingMetadata() {
        #expect(throws: PanelAppCatalog.ValidationError.emptyMetadata) {
            try PanelAppCatalog(apps: [
                .init(id: "empty", name: "", symbol: "gear", accent: "#ffffff", route: .settings)
            ])
        }
    }
    @Test func navigationReturnsToLauncherAndRejectsUnknownApps() {
        var state = PanelShellState()
        #expect(state.screen == .clock)
        state.showLauncher()
        let opened = state.open("music")
        #expect(opened)
        #expect(state.screen == .app("music"))
        let missing = state.open("missing")
        #expect(!missing)
        #expect(state.screen == .app("music"))
        state.showLauncher()
        #expect(state.screen == .launcher)
        state.showClock()
        #expect(state.screen == .clock)
    }

    @Test func disappearingDestinationRecoversOnlyMatchingStaleApp() {
        var state = PanelShellState()
        let opened = state.open("car")
        #expect(opened)
        #expect(state.launcherCanReceiveInput)
        let wrongDestination = state.appDestinationDisappeared("settings")
        #expect(!wrongDestination)
        #expect(state.screen == .app("car"))
        let recovered = state.appDestinationDisappeared("car")
        #expect(recovered)
        #expect(state.screen == .launcher)
        #expect(state.launcherCanReceiveInput)
        let alreadyDismissed = state.appDestinationDisappeared("car")
        #expect(!alreadyDismissed)
        let settingsOpened = state.open("settings")
        #expect(settingsOpened)
        let oldAppDisappeared = state.appDestinationDisappeared("car")
        #expect(!oldAppDisappeared)
        #expect(state.screen == .app("settings"))
        let settingsRecovered = state.appDestinationDisappeared("settings")
        #expect(settingsRecovered)
        #expect(state.screen == .launcher)
        let reopened = state.open("car")
        #expect(reopened)
        state.showClock()
        let clockMustStay = state.appDestinationDisappeared("car")
        #expect(!clockMustStay)
        #expect(state.screen == .clock)
        #expect(!state.launcherCanReceiveInput)
    }
}
