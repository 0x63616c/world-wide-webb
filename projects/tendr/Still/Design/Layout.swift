import SwiftUI

extension View {
  /// The standard card, with concentric corners on systems that support them.
  func card() -> some View {
    padding(RSpacing.l).rSurface(
      RPalette.card, cornerRadius: RRadius.card, border: RPalette.hairline)
  }

  /// Retain the family radius away from edges, and follow a containing card, sheet
  /// or window near its corners. Give nested surfaces the family's container radius.
  @ViewBuilder func rSurface<S: ShapeStyle>(
    _ style: S, cornerRadius: CGFloat, border: Color = .clear
  ) -> some View {
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
}

/// A page title in the same position on every tab, with an optional trailing control.
struct PageHeader<Trailing: View>: View {
  let title: String
  @ViewBuilder let trailing: Trailing
  init(_ title: String, @ViewBuilder trailing: () -> Trailing) {
    self.title = title
    self.trailing = trailing()
  }
  var body: some View {
    HStack(alignment: .center) {
      Text(title)
        .font(.largeTitle.bold())
        .accessibilityIdentifier("pageHeader-\(title)")
      Spacer()
      // Taller trailing controls lay out at 44 pt and overflow evenly, so every page title
      // sits at the same position.
      trailing.frame(maxHeight: 44)
    }.frame(minHeight: 44)
  }
}

extension PageHeader where Trailing == EmptyView {
  init(_ title: String) { self.init(title) { EmptyView() } }
}

/// Capsule filter chips. The selected chip uses the current tint (`.tint(_:)`).
struct FilterBar<Value: Hashable>: View {
  @Binding var selection: Value
  var options: [(Value, String)]
  init(selection: Binding<Value>, options: [(Value, String)]) {
    _selection = selection
    self.options = options
  }
  var body: some View {
    ViewThatFits(in: .horizontal) {
      buttons
      ScrollView(.horizontal, showsIndicators: false) { buttons }
    }
  }
  private var buttons: some View {
    HStack(spacing: 6) {
      ForEach(options, id: \.0) { value, title in
        Button {
          selection = value
        } label: {
          Text(title).font(.subheadline.weight(.semibold)).fixedSize()
            .padding(.horizontal, 15).frame(minHeight: 44)
            .foregroundStyle(selection == value ? RPalette.background : Color.primary)
            .background(
              selection == value ? AnyShapeStyle(.tint) : AnyShapeStyle(RPalette.card),
              in: Capsule())
        }.buttonStyle(.plain)
          .accessibilityAddTraits(selection == value ? .isSelected : [])
      }
    }
  }
}
