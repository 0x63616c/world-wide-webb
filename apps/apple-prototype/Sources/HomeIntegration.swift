import SwiftUI

/// Optional host presentation; nil preserves the design app's own content.
/// A stable reference keeps behavior out of closure-valued environment keys.
@MainActor protocol HomeIntegration: AnyObject {
    var caption: String { get }
    func prepareToOpen(_ tile: HomeTile) -> Bool
    func available(_ tile: HomeTile) -> Bool
    func tile(_ tile: HomeTile, open: @escaping () -> Void) -> AnyView?
    /// Grid content owns its 24 pt ink inset; the grid owns span, material and radius.
    /// Return nil to keep the prototype card. Do not add an outer card surface.
    func gridTile(_ tile: HomeTile, span: CGSize, open: @escaping () -> Void) -> AnyView?
    func musicFace(close: @escaping () -> Void) -> AnyView
    func destination(_ tile: HomeTile, close: @escaping () -> Void) -> AnyView
}

extension HomeIntegration {
    func gridTile(_ tile: HomeTile, span: CGSize, open: @escaping () -> Void) -> AnyView? { nil }
}

extension EnvironmentValues {
    @Entry var homeIntegration: (any HomeIntegration)?
}
