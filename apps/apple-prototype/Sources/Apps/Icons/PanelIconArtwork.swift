import SwiftUI

enum PanelIconArtwork: String, CaseIterable {
    case weather, lights, music, photos

    /// Fixed artwork colors from the approved designs. Light always comes from above.
    var background: LinearGradient {
        let colors: [Color] = switch self {
        case .weather: [Color(hex: "#05D5ED"), Color(hex: "#0085FF")]
        case .lights: [Color(hex: "#FFD500"), Color(hex: "#FF6500")]
        case .music: [Color(hex: "#FF5275"), Color(hex: "#D60040")]
        case .photos: [Color(hex: "#BE85FC"), Color(hex: "#7A12F8")]
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
            case .weather: WeatherIconArtwork(side: side, parallax: parallax)
            case .lights: LightsIconArtwork(side: side, parallax: parallax)
            case .music: MusicIconArtwork(side: side, parallax: parallax)
            case .photos: PhotosIconArtwork(side: side, parallax: parallax)
            }
        }
        .frame(width: side, height: side)
        .compositingGroup()
        .clipShape(.rect(cornerRadius: side * 0.25, style: .continuous))
    }
}

private struct IconLayer: ViewModifier {
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
                .fill(LinearGradient(colors: [Color(hex: "#FFE000"), Color(hex: "#FFD000")], startPoint: .top, endPoint: .bottom))
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
        }.frame(width: side, height: side)
    }
}

private struct MusicIconArtwork: View {
    let side: CGFloat
    let parallax: CGSize
    var body: some View {
        ZStack {
            ZStack {
                Circle().fill(Color(hex: "#F77497"))
                    .frame(width: side * 0.370, height: side * 0.370)
                Circle().fill(Color(hex: "#D7305C"))
                    .frame(width: side * 0.061, height: side * 0.061)
            }
            .position(x: side * 0.329, y: side * 0.412)
            .modifier(IconLayer(parallax: parallax, side: side, depth: 0.012))
            PanelIconShape.musicNotes.fill(.white)
                .modifier(IconLayer(parallax: parallax, side: side, depth: 0.028))
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
