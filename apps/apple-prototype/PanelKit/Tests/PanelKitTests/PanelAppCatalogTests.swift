import Testing
@testable import PanelKit

@Suite struct PanelAppCatalogTests {
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
            try PanelAppCatalog(apps: [.init(id: "empty", name: "", symbol: "gear", accent: "#ffffff", route: .settings)])
        }
    }
    @Test func classicRequiresHostCapability() {
        let catalog = PanelAppCatalog.standard
        #expect(!catalog.visibleApps(classicSupported: false).contains { $0.route == .classic })
        #expect(catalog.visibleApps(classicSupported: true).filter { $0.route == .classic }.count == 1)
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
}
