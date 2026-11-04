import SwiftUI

/// Match recorded carrier names only; ambiguous imports retain a neutral mark.
struct AirlineLogo: View {
    var airline: String
    var size: CGFloat = 24
    private var code: String? {
        ["Delta": "DL", "Alaska": "AS", "Frontier": "F9", "United": "UA",
         "American": "AA", "JetBlue": "B6", "Virgin Atlantic": "VS",
         "Ryanair": "FR", "easyJet": "U2", "Norwegian": "DY", "Wizz Air": "W6",
         "Air New Zealand": "NZ", "China Southern": "CZ", "Hainan": "HU"][airline]
    }
    var body: some View {
        Group {
            if let code {
                Image("Airline-\(code)").resizable().scaledToFit().saturation(0)
                    // The red-on-navy Delta mark needs its own grayscale levels.
                    .brightness(code == "DL" ? 0.35 : 0)
                    .contrast(code == "DL" ? 5 : 1)
            } else {
                Image(systemName: "airplane").font(.system(size: size * 0.52))
                    .foregroundStyle(.secondary).frame(width: size, height: size)
                    .background(Color.primary.opacity(0.06))
            }
        }.frame(width: size, height: size)
            .clipShape(RoundedRectangle(cornerRadius: size * 0.22))
            .accessibilityHidden(true)
    }
}
