import CoreImage.CIFilterBuiltins
import SwiftUI

enum WifiQRCode {
    static func payload(for wifi: WifiState) -> String? {
        guard let ssid = wifi.ssid, !ssid.isEmpty else { return nil }
        guard let password = wifi.password, !password.isEmpty else {
            return "WIFI:T:nopass;S:\(escape(ssid));;"
        }
        return "WIFI:T:WPA;S:\(escape(ssid));P:\(escape(password));;"
    }

    private static func escape(_ value: String) -> String {
        value.reduce(into: "") { result, character in
            if "\\;,:\"".contains(character) { result.append("\\") }
            result.append(character)
        }
    }

    static func render(_ wifi: WifiState) -> CGImage? {
        guard let payload = payload(for: wifi) else { return nil }
        let filter = CIFilter.qrCodeGenerator()
        filter.message = Data(payload.utf8)
        filter.correctionLevel = "M"
        guard let output = filter.outputImage else { return nil }
        return CIContext().createCGImage(output, from: output.extent)
    }
}

struct WifiQRHero: View {
    let image: CGImage
    var body: some View {
        GeometryReader { proxy in
            // Keep an integer number of physical pixels per module, plus at least
            // four white modules of quiet zone on every side (including corners).
            let modules = CGFloat(image.width)
            let pixelsPerModule = floor(proxy.size.width * displayScale / (modules + 10))
            let codeSide = modules * pixelsPerModule / displayScale
            Image(decorative: image, scale: 1)
                .resizable().interpolation(.none)
                .frame(width: codeSide, height: codeSide)
                .frame(width: proxy.size.width, height: proxy.size.height)
                .background(.white, in: .rect(cornerRadius: 32))
                .compositingGroup()
                .shadow(color: .black.opacity(0.18), radius: 28, y: 16)
        }.aspectRatio(1, contentMode: .fit)
            .accessibilityLabel("Guest Wi-Fi join QR code")
    }
    @Environment(\.displayScale) private var displayScale
}
