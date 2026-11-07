import SwiftUI

/// Vehicle status is read-only; the lock glyph reports telemetry without an action.
struct TeslaModule: View {
    let provider: LiveTeslaProvider

    var body: some View {
        TeslaController(provider: provider)
    }
}
