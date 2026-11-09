#if canImport(SwiftUI)
import SwiftUI

public enum RFont {
    public static let pageTitle = Font.largeTitle.bold()
    public static let cardTitle = Font.headline
    public static let eyebrow = Font.system(size: 10, weight: .bold)
    /// Rounded numerals for headline values (weights, amounts).
    public static func metric(_ size: CGFloat, weight: Font.Weight = .bold) -> Font { .system(size: size, weight: weight, design: .rounded) }
}

public extension View {
    /// The tracked uppercase label used above card titles.
    func rEyebrow() -> some View { font(RFont.eyebrow).tracking(1.6).textCase(.uppercase) }

    /// The standard card, with concentric corners on systems that support them.
    func card() -> some View {
        padding(RSpacing.l).rSurface(RPalette.card, cornerRadius: RRadius.card, border: RPalette.hairline)
    }

    /// Retain the family radius away from edges, and follow a containing card, sheet
    /// or window near its corners. Give nested surfaces the family's container radius.
    @ViewBuilder func rSurface<S: ShapeStyle>(_ style: S, cornerRadius: CGFloat, border: Color = .clear) -> some View {
        if #available(iOS 26.0, macOS 26.0, *) {
            let shape = ConcentricRectangle(corners: .concentric(minimum: .fixed(cornerRadius)))
            // ConcentricRectangle is a Shape, not an InsettableShape or
            // RoundedRectangularShape accepted by containerShape(_:).
            self.containerShape(RoundedRectangle(cornerRadius: cornerRadius))
                .background(style, in: shape)
                .clipShape(shape)
                .overlay(shape.stroke(border, lineWidth: 1))
        } else {
            let shape = RoundedRectangle(cornerRadius: cornerRadius)
            self.background(style, in: shape)
                .overlay(shape.stroke(border, lineWidth: 1))
        }
    }

    /// A tappable row inside a card or list: comfortable height and a full-width hit area.
    func rRow() -> some View { padding(.vertical, RSpacing.xs).frame(minHeight: 44).contentShape(Rectangle()) }
}

/// A page title in the same position on every tab, with an optional trailing control.
public struct PageHeader<Trailing: View>: View {
    let title: String
    @ViewBuilder let trailing: Trailing
    public init(_ title: String, @ViewBuilder trailing: () -> Trailing) { self.title = title; self.trailing = trailing() }
    public var body: some View {
        HStack(alignment: .center) {
            Text(title)
                .font(RFont.pageTitle)
                .accessibilityIdentifier("pageHeader-\(title)")
            Spacer()
            // Taller trailing controls lay out at 44 pt and overflow evenly, so every page title
            // sits at the same position.
            trailing.frame(maxHeight: 44)
        }.frame(minHeight: 44)
    }
}

public extension PageHeader where Trailing == EmptyView {
    init(_ title: String) { self.init(title) { EmptyView() } }
}

/// Capsule filter chips. The selected chip uses the current tint (`.tint(_:)`).
public struct FilterBar<Value: Hashable>: View {
    @Binding var selection: Value
    var options: [(Value, String)]
    public init(selection: Binding<Value>, options: [(Value, String)]) { _selection = selection; self.options = options }
    public var body: some View {
        ViewThatFits(in: .horizontal) {
            buttons
            ScrollView(.horizontal, showsIndicators: false) { buttons }
        }
    }
    private var buttons: some View {
        HStack(spacing: 6) {
            ForEach(options, id: \.0) { value, title in
                Button { selection = value } label: {
                    Text(title).font(.subheadline.weight(.semibold)).fixedSize()
                        .padding(.horizontal, 15).frame(minHeight: 44)
                        .foregroundStyle(selection == value ? RPalette.background : Color.primary)
                        .background(selection == value ? AnyShapeStyle(.tint) : AnyShapeStyle(RPalette.card), in: Capsule())
                }.buttonStyle(.plain)
                    .accessibilityAddTraits(selection == value ? .isSelected : [])
            }
        }
    }
}

#endif
