import SwiftUI

/// Optional host presentation; nil preserves the design app's own content.
/// A stable reference keeps behavior out of closure-valued environment keys.
@MainActor protocol HomeIntegration: AnyObject {
    var caption: String { get }
    func prepareToOpen(_ tile: HomeTile) -> Bool
    func available(_ tile: HomeTile) -> Bool
    func tile(_ tile: HomeTile, open: @escaping () -> Void) -> AnyView?
    func musicFace(close: @escaping () -> Void) -> AnyView
    func destination(_ tile: HomeTile, close: @escaping () -> Void) -> AnyView
}

extension EnvironmentValues {
    @Entry var homeIntegration: (any HomeIntegration)?
}
