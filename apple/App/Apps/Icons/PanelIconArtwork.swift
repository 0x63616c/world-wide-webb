import SwiftUI

enum PanelIconArtwork: String, CaseIterable {
    case calendar, weather, lights, climate, walks, photos, car, wifi, music, clock, timer, booth, settings

    /// The approved palette extended across the complete app family. Light comes from above.
    var background: LinearGradient {
        let colors: [Color] =
            switch self {
            case .calendar: [Color(hex: "#FF796D"), Color(hex: "#EF344E")]
            case .weather: [Color(hex: "#05D5ED"), Color(hex: "#0085FF")]
            case .lights: [Color(hex: "#FFD500"), Color(hex: "#FF6500")]
            case .climate: [Color(hex: "#56D9FA"), Color(hex: "#007FCF")]
            case .walks: [Color(hex: "#60DD9C"), Color(hex: "#0CAA69")]
            case .music: [Color(hex: "#252527"), .black]
            case .photos: [Color(hex: "#BE85FC"), Color(hex: "#7A12F8")]
            case .car: [Color(hex: "#6CBFFC"), Color(hex: "#2367D2")]
            case .wifi: [Color(hex: "#59E0DD"), Color(hex: "#009BAE")]
            case .clock: [Color(hex: "#65D9B7"), Color(hex: "#15936F")]
            case .timer: [Color(hex: "#FFC65E"), Color(hex: "#F47A12")]
            case .booth: [Color(hex: "#FF8DAD"), Color(hex: "#DF3979")]
            case .settings: [Color(hex: "#ADB8C8"), Color(hex: "#586A84")]
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
            case .walks: WalksIconArtwork(side: side, parallax: parallax)
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
    var body: some View {
        ZStack {
            Circle()
                .fill(
                    LinearGradient(
                        colors: [Color(hex: "#FFE000"), Color(hex: "#FFD000")], startPoint: .top, endPoint: .bottom)
                )
                .frame(width: side * 0.362, height: side * 0.362)
                .position(x: side * 0.347, y: side * 0.415)
                .modifier(IconLayer(parallax: parallax, side: side, depth: 0.012))
            PanelIconShape.cloud.fill(.white)
                .modifier(IconLayer(parallax: parallax, side: side, depth: 0.028))
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

    var body: some View {
        ZStack {
            speaker(scale: 0.85, cabinet: Color(hex: "#A6A6AC"), driver: Color(hex: "#39393E"))
                .position(x: side * 0.644, y: side * 0.428)
                .modifier(IconLayer(parallax: parallax, side: side, depth: 0.012))
            speaker(scale: 1, cabinet: .white, driver: Color(hex: "#232326"))
                .position(x: side * 0.409, y: side * 0.548)
                .modifier(IconLayer(parallax: parallax, side: side, depth: 0.028))
        }.frame(width: side, height: side)
    }

    private func speaker(scale: CGFloat, cabinet: Color, driver: Color) -> some View {
        let unit = side * scale
        return RoundedRectangle(cornerRadius: unit * 0.085, style: .continuous)
            .fill(cabinet)
            .frame(width: unit * 0.35, height: unit * 0.55)
            .overlay {
                VStack(spacing: unit * 0.055) {
                    Circle().fill(driver).frame(width: unit * 0.095)
                    Circle().fill(driver).frame(width: unit * 0.22)
                        .overlay { Circle().fill(cabinet.opacity(0.58)).frame(width: unit * 0.085) }
                }
            }
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
