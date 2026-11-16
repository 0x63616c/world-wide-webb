import SwiftUI

struct MixedTileMaterial: ViewModifier {
    let round: Bool
    let on: Bool
    var imageContent = false
    @Environment(\.horizontalSizeClass) private var sizeClass
    private var radius: CGFloat { sizeClass == .compact ? 36 : 56 }
    func body(content: Content) -> some View {
        let glass =
            imageContent
            ? Glass.clear
            : on
                ? Glass.regular.tint(.orange.mix(with: .white, by: 0.90).opacity(0.65))
                : Glass.regular.tint(.white.opacity(0.05))
        Group {
            if round {
                content.glassEffect(glass.interactive(), in: .circle)
            } else {
                content.glassEffect(glass.interactive(), in: .rect(cornerRadius: radius))
                    .containerShape(.rect(cornerRadius: radius))
            }
        }.environment(\.colorScheme, on ? .light : .dark)
    }
}
