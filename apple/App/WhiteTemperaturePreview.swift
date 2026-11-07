import SwiftUI

/// Approximate screen colours for the lamps' supported warm-to-daylight range.
/// Interpolation keeps the live preview continuous between the reference swatches.
enum WhiteTemperaturePreview {
    private static let swatches: [(kelvin: Int, red: Double, green: Double, blue: Double)] = [
        (2000, 1, 0.537, 0.071), (2500, 1, 0.631, 0.282),
        (3000, 1, 0.694, 0.431), (3500, 1, 0.757, 0.553),
        (4000, 1, 0.808, 0.651), (5000, 1, 0.894, 0.808),
        (6500, 1, 0.996, 0.980),
    ]
    static func color(_ kelvin: Int) -> Color {
        let value = min(6500, max(2000, kelvin))
        for (low, high) in zip(swatches, swatches.dropFirst()) where value <= high.kelvin {
            let fraction = Double(value - low.kelvin) / Double(high.kelvin - low.kelvin)
            return Color(
                red: low.red + (high.red - low.red) * fraction,
                green: low.green + (high.green - low.green) * fraction,
                blue: low.blue + (high.blue - low.blue) * fraction)
        }
        return .white
    }
    static var gradient: Gradient {
        Gradient(
            stops: swatches.map { swatch in
                .init(color: color(swatch.kelvin), location: Double(swatch.kelvin - 2000) / 4500)
            })
    }
}
