import SwiftUI

enum PanelIconArtwork: String, CaseIterable {
    case calendar, weather, lights, climate, photos, car, wifi, music, clock, timer, booth, settings

    /// The approved palette extended across the complete app family. Light comes from above.
    var background: LinearGradient {
        let colors: [Color] =
            switch self {
            case .calendar: [Color(hex: "#E3DED4"), Color(hex: "#CFC9BD")]
            case .weather: [Color(hex: "#3F7EC8"), Color(hex: "#2D61A4")]
            case .lights: [Color(hex: "#FFD500"), Color(hex: "#FF6500")]
            case .climate: [Color(hex: "#56D9FA"), Color(hex: "#007FCF")]
            case .music: [Color(hex: "#2B2B30"), Color(hex: "#2B2B30")]
            case .photos: [Color(hex: "#BE85FC"), Color(hex: "#7A12F8")]
            case .car: [Color(hex: "#6CBFFC"), Color(hex: "#2367D2")]
            case .wifi: [Color(hex: "#E6E6E8"), Color(hex: "#CFCFD3")]
            case .clock: [Color(hex: "#65D9B7"), Color(hex: "#15936F")]
            case .timer: [Color.orange.mix(with: .white, by: 0.12), .orange]
            case .booth: [Color(hex: "#FF8DAD"), Color(hex: "#DF3979")]
            case .settings: [Color(hex: "#7E8693"), Color(hex: "#5E6572")]
            }
        return LinearGradient(colors: colors, startPoint: .top, endPoint: .bottom)
    }
}

/// Each foreground is independent of the opaque background and the final mask.
/// Motion is supplied by the launcher; notification artwork stays at rest.
struct PanelIconArtworkView: View {
    let artwork: PanelIconArtwork
    let side: CGFloat
    var parallax: CGSize = .zero

    var body: some View {
        ZStack {
            artwork.background
            switch artwork {
            case .calendar: CalendarIconArtwork(side: side, parallax: parallax)
            case .weather: WeatherIconArtwork(side: side, parallax: parallax)
            case .lights: LightsIconArtwork(side: side, parallax: parallax)
            case .climate: ClimateIconArtwork(side: side, parallax: parallax)
            case .music: SonosIconArtwork(side: side, parallax: parallax)
            case .photos: PhotosIconArtwork(side: side, parallax: parallax)
            case .car: CarIconArtwork(side: side, parallax: parallax)
            case .wifi: WifiIconArtwork(side: side, parallax: parallax)
            case .clock: ClockIconArtwork(side: side, parallax: parallax)
            case .timer: TimerIconArtwork(side: side, parallax: parallax)
            case .booth: BoothIconArtwork(side: side, parallax: parallax)
            case .settings: SettingsIconArtwork(side: side, parallax: parallax)
            }
        }
        .frame(width: side, height: side)
        .compositingGroup()
        .clipShape(.rect(cornerRadius: side * 0.25, style: .continuous))
    }
}

struct IconLayer: ViewModifier {
    let parallax: CGSize
    let side: CGFloat
    let depth: CGFloat

    func body(content: Content) -> some View {
        content.offset(x: parallax.width * side * depth, y: parallax.height * side * depth)
    }
}

private struct WeatherIconArtwork: View {
    let side: CGFloat
    let parallax: CGSize
    private let sunDepth: CGFloat = 0.012
    private let cloudDepth: CGFloat = 0.028
    var body: some View {
        ZStack {
            Circle()
                .fill(
                    LinearGradient(
                        colors: [Color(hex: "#F9D152"), Color(hex: "#F2B233")], startPoint: .top, endPoint: .bottom)
                )
                .frame(width: side * 0.306, height: side * 0.306)
                .position(x: side * 0.645, y: side * 0.389)
                .frame(width: side, height: side)
                // A clear gap follows the cloud's outline, wherever parallax puts it.
                .overlay {
                    PanelIconShape.cloud
                        .stroke(.black, style: StrokeStyle(lineWidth: side * 0.048, lineJoin: .round))
                        .background(PanelIconShape.cloud.fill(.black))
                        .offset(
                            x: parallax.width * side * (cloudDepth - sunDepth),
                            y: parallax.height * side * (cloudDepth - sunDepth)
                        )
                        .blendMode(.destinationOut)
                }
                .compositingGroup()
                .modifier(IconLayer(parallax: parallax, side: side, depth: sunDepth))
            PanelIconShape.cloud
                .fill(
                    LinearGradient(
                        stops: [.init(color: .white, location: 0.3), .init(color: Color(hex: "#DCE7F4"), location: 1)],
                        startPoint: UnitPoint(x: 0.5, y: 0.381), endPoint: UnitPoint(x: 0.5, y: 0.764))
                )
                .shadow(color: .black.opacity(0.2), radius: side * 0.007, y: side * 0.008)
                .modifier(IconLayer(parallax: parallax, side: side, depth: cloudDepth))
        }.frame(width: side, height: side)
    }
}

private struct LightsIconArtwork: View {
    let side: CGFloat
    let parallax: CGSize
    var body: some View {
        ZStack {
            ZStack {
                Ellipse().fill(Color(hex: "#009AFF"))
                    .frame(width: side * 0.153, height: side * 0.100)
                    .position(x: side * 0.499, y: side * 0.820)
                Capsule().fill(Color(hex: "#9DDFFC"))
                    .frame(width: side * 0.240, height: side * 0.071)
                    .position(x: side * 0.499, y: side * 0.785)
                Capsule().fill(Color(hex: "#A5E2FC"))
                    .frame(width: side * 0.258, height: side * 0.069)
                    .position(x: side * 0.499, y: side * 0.715)
            }.modifier(IconLayer(parallax: parallax, side: side, depth: 0.012))
            PanelIconShape.bulb.fill(.white)
                .modifier(IconLayer(parallax: parallax, side: side, depth: 0.028))
        }
        .frame(width: side, height: side)
        // The slender bulb needs the same visual inset as the wider cloud/notes.
        .scaleEffect(0.86)
    }
}

private struct SonosIconArtwork: View {
    let side: CGFloat
    let parallax: CGSize
    /// Level bars: centre x, height and parallax depth, as fractions of the icon side.
    private let bars: [(x: CGFloat, height: CGFloat, depth: CGFloat)] = [
        (0.292, 0.293, 0.012), (0.439, 0.559, 0.028), (0.585, 0.410, 0.028), (0.731, 0.215, 0.012),
    ]

    var body: some View {
        ZStack {
            ForEach(bars.indices, id: \.self) { index in
                Capsule().fill(.white)
                    .frame(width: side * 0.1015, height: side * bars[index].height)
                    .position(x: side * bars[index].x, y: side * 0.5)
                    .modifier(IconLayer(parallax: parallax, side: side, depth: bars[index].depth))
            }
        }.frame(width: side, height: side)
    }
}

private struct PhotosIconArtwork: View {
    let side: CGFloat
    let parallax: CGSize
    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: side * 0.075)
                .fill(Color(hex: "#F5EFFF"))
                .overlay {
                    RoundedRectangle(cornerRadius: side * 0.035).fill(Color(hex: "#C8AAFC"))
                        .padding(side * 0.045)
                }
                .frame(width: side * 0.520, height: side * 0.495)
                .rotationEffect(.degrees(-10))
                .position(x: side * 0.414, y: side * 0.438)
                .modifier(IconLayer(parallax: parallax, side: side, depth: 0.012))
            RoundedRectangle(cornerRadius: side * 0.075)
                .fill(.white)
                .overlay {
                    PhotoIconLandscape(side: side)
                        .padding(side * 0.045)
                }
                .frame(width: side * 0.515, height: side * 0.495)
                .position(x: side * 0.570, y: side * 0.545)
                .modifier(IconLayer(parallax: parallax, side: side, depth: 0.028))
        }.frame(width: side, height: side)
    }
}

private struct PhotoIconLandscape: View {
    let side: CGFloat
    var body: some View {
        ZStack(alignment: .topTrailing) {
            Color(hex: "#2CB6F7")
            Circle().fill(Color(hex: "#FFD035"))
                .frame(width: side * 0.130, height: side * 0.130)
                .padding(.top, side * 0.047).padding(.trailing, side * 0.052)
            PanelIconShape.hill.fill(Color(hex: "#08B391"))
        }
        .compositingGroup()
        .clipShape(.rect(cornerRadius: side * 0.035))
    }
}
