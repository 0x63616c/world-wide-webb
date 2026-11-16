import PanelKit
import SwiftUI

/// Optional host presentation; nil preserves the design app's own content.
/// A stable reference keeps behavior out of closure-valued environment keys.
@MainActor protocol HomeIntegration: AnyObject {
    var panelPIN: PanelPINAPI? { get }
    var profilesAPI: ProfilesAPI? { get }
    func photoBooth(close: @escaping () -> Void) -> AnyView?
    func artwork(_ room: SoundRoom) -> AnyView?
    func destination(_ tile: HomeTile, close: @escaping () -> Void) -> AnyView
}

extension HomeIntegration {
    func photoBooth(close: @escaping () -> Void) -> AnyView? { nil }
    var panelPIN: PanelPINAPI? { nil }
    var profilesAPI: ProfilesAPI? { nil }
    func artwork(_ room: SoundRoom) -> AnyView? { nil }
}

extension EnvironmentValues {
    @Entry var homeIntegration: (any HomeIntegration)?
}
