import SwiftUI

struct WifiController: View {
    let wifi: WifiState
    var body: some View {
        GeometryReader { proxy in
            if let ssid = wifi.ssid, !ssid.isEmpty {
                VStack(spacing: 16) {
                    Text("Scan to join").font(.system(size: min(28, proxy.size.width * 0.065), weight: .medium))
                        .padding(.bottom, 8)
                    if let image = WifiQRCode.render(wifi) {
                        WifiQRHero(image: image)
                            .frame(
                                width: min(proxy.size.width - 48, proxy.size.height * 0.66),
                                height: min(proxy.size.width - 48, proxy.size.height * 0.66)
                            )
                            .padding(.bottom, 10)
                    }
                    Text(ssid).font(.system(size: min(44, proxy.size.width * 0.09), weight: .semibold)).textSelection(
                        .enabled
                    )
                    .lineLimit(1).minimumScaleFactor(0.6)
                    Text("Password").font(.system(size: 18)).foregroundStyle(.secondary)
                    Text(wifi.password.flatMap { $0.isEmpty ? nil : $0 } ?? "No password")
                        .font(.system(size: min(28, proxy.size.width * 0.06), weight: .medium, design: .monospaced))
                        .textSelection(.enabled).lineLimit(1).minimumScaleFactor(0.5)
                }.frame(maxWidth: .infinity, maxHeight: .infinity).padding(.horizontal, 40)
            } else {
                VStack(spacing: 36) {
                    Image(systemName: "wifi").font(.system(size: 85, weight: .light)).opacity(0.85)
                    Text("Guest network not configured").font(.system(size: 48, weight: .light))
                }.frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
    }
}
#Preview("Wi-Fi · Open", traits: .fixedLayout(width: 1366, height: 1024)) {
    WifiController(wifi: .open).background(Palette.teal)
}
#Preview("Wi-Fi · Not configured", traits: .fixedLayout(width: 1366, height: 1024)) {
    WifiController(wifi: .unconfigured).background(Palette.teal)
}
