import SwiftUI

/// Launcher artwork is authored in Icon Composer (`apple/Design/LauncherIcons`) and rendered
/// with its Liquid Glass materials by `tools/render_launcher_icons.sh`.
enum PanelIconArtwork: String, CaseIterable {
    case calendar, weather, lights, climate, photos, car, wifi, music, clock, timer, booth, settings
}

struct PanelIconArtworkView: View {
    let artwork: PanelIconArtwork
    let side: CGFloat

    var body: some View {
        Image("LauncherIcon-\(artwork.rawValue)")
            .resizable()
            .interpolation(.high)
            .overlay { if artwork == .calendar { CalendarIconDate(side: side) } }
            .frame(width: side, height: side)
            .clipShape(.rect(cornerRadius: side * 0.25, style: .continuous))
    }
}

/// Today's weekday and day, drawn live on the rendered white calendar tile.
private struct CalendarIconDate: View {
    let side: CGFloat
    var body: some View {
        TimelineView(.periodic(from: .now, by: 60)) { context in
            // Each line is placed by its baseline so the two sit on fixed optical lines.
            Color.clear
                .overlay(alignment: .top) {
                    Text(context.date.formatted(.dateTime.weekday(.abbreviated)).uppercased())
                        .font(.system(size: side * 0.165, weight: .heavy))
                        .tracking(side * 0.011)
                        .foregroundStyle(Color(hex: "#D2402E"))
                        .modifier(IconBaseline(y: side * 0.347))
                }
                .overlay(alignment: .top) {
                    Text(context.date.formatted(.dateTime.day()))
                        .font(.system(size: side * 0.475, weight: .bold))
                        .tracking(-side * 0.009)
                        .foregroundStyle(Color(hex: "#18181B"))
                        .modifier(IconBaseline(y: side * 0.764))
                }
        }
    }
}

/// Puts a text line's first baseline `y` points below the top of the view it overlays.
/// An overlay never changes its host's size, so tall glyphs cannot shift the artwork.
private struct IconBaseline: ViewModifier {
    let y: CGFloat
    func body(content: Content) -> some View {
        content.lineLimit(1).fixedSize()
            .alignmentGuide(.top) { $0[.firstTextBaseline] - y }
    }
}
