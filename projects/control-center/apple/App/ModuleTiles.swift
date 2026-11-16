import SwiftUI

struct ModuleTile: View {
    let tile: HomeTile
    let store: any HomeDataSource
    let open: () -> Void
    @Environment(\.horizontalSizeClass) private var sizeClass
    private var compact: Bool { sizeClass == .compact }
    private var radius: CGFloat { compact ? 36 : 56 }
    var body: some View {
        Button(action: open) {
            Group {
                switch tile {
                case .calendar: calendar
                default: EmptyView()
                }
            }.frame(maxWidth: .infinity, maxHeight: .infinity)
                .contentShape(.rect(cornerRadius: radius))
        }.buttonStyle(.plain).clipShape(ConcentricRectangle()).containerShape(.rect(cornerRadius: radius))
            .accessibilityLabel("Open \(tile.title)")
    }
    private var calendar: some View {
        HStack(alignment: .top, spacing: 24) {
            VStack(spacing: 0) {
                Text(store.calendar.dateText(at: store.now, format: "EEE").uppercased()).font(
                    .system(size: compact ? 14 : 20, weight: .semibold)
                ).foregroundStyle(.red)
                Text(store.calendar.dateText(at: store.now, format: "d")).font(
                    .system(size: compact ? 44 : 60, weight: .light))
            }
            VStack(alignment: .leading, spacing: 8) {
                Text("UP NEXT").font(.system(size: compact ? 11 : 13, weight: .semibold)).foregroundStyle(.primary)
                if let event = store.calendar.next(at: store.now) {
                    Text(event.title).font(.system(size: compact ? 20 : 32, weight: .semibold)).lineLimit(1)
                    Text("\(event.time) \(event.period)").font(.system(size: compact ? 16 : 24))
                    Text(event.location).font(.system(size: compact ? 15 : 20)).foregroundStyle(.primary).lineLimit(1)
                } else {
                    Text("Nothing else today").font(.title3)
                }
            }
            Spacer(minLength: 0)
        }.padding(compact ? 24 : 32).frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .center)
    }
}
