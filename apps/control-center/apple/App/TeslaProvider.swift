import PanelKit
import SwiftUI

/// Field names and value types mirror the retired features/tesla/service.ts contract.
struct TeslaData: Equatable {
    var name = "Model Y"
    var nick = "Evee"
    var place = "Home"
    var lat: Double? = nil
    var lon: Double? = nil
    var charging = true
    var chargingState = "charging"
    var preconditioning = false
    var rate: Double = 11
    var pct = 78
    var range = 241
    /// Full-charge range, shown as "241/250 mi" on the Home grid car tile.
    var maxRange = 250
    var locked = true
    var odo = "12,480"
    var climate = 64
    var softwareUpdate: TeslaSoftwareUpdate? = nil
    var driveState: TeslaDriveState? = nil
    var cableConnected: Bool? = nil
    var chargeLimitPercent: Double? = nil
    var chargeCompleteAt: Date? = nil
    var lastUpdatedAt: Date? = nil

    var isInGear: Bool { driveState?.isInGear == true }
    var isInstalling: Bool { softwareUpdate?.status == "installing" }
    var chargeLabel: String {
        switch chargingState {
        case "charging": "Charging"
        case "starting": "Starting charge"
        case "complete": "Charge complete"
        case "stopped": "Charge paused"
        case "no_power": "No power"
        case "disconnected": "Unplugged"
        default: "Charge status unknown"
        }
    }
    var driveLabel: String? {
        switch driveState {
        case .parked: "Parked"
        case .driving: "Driving"
        case .reversing: "Reversing"
        case .neutral: "In neutral"
        case nil: nil
        }
    }
    static func date(_ value: String?) -> Date? {
        guard let value else { return nil }
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.date(from: value) ?? ISO8601DateFormatter().date(from: value)
    }
}
enum TeslaAvailability: String, CaseIterable { case online, asleep, offline }

@MainActor protocol TeslaProvider: AnyObject, Observable {
    var data: TeslaData { get }
    var availability: TeslaAvailability { get }
    func mileageHistory() async throws -> [TeslaMileagePoint]
}

@MainActor @Observable final class MockTeslaProvider: TeslaProvider {
    private(set) var data: TeslaData
    let availability: TeslaAvailability
    func mileageHistory() async throws -> [TeslaMileagePoint] {
        let now = Date().timeIntervalSince1970 * 1000
        return (0..<12).map { TeslaMileagePoint(timestamp: now - Double(11 - $0) * 86400 * 1000, miles: 12_200 + Double($0) * 25) }
    }
    init(data: TeslaData = TeslaData(), availability: TeslaAvailability = .online) {
        var data = data
        // Capture flag for the unlocked review render.
        if ProcessInfo.processInfo.arguments.contains("-carUnlocked") { data.locked = false }
        self.data = data
        self.availability = availability
    }

}

struct TeslaTile: View {
    let provider: any TeslaProvider
    private var data: TeslaData { provider.data }
    var body: some View {
        HStack(spacing: 8) {
            VStack(alignment: .leading, spacing: 12) {
                HStack(spacing: 8) {
                    Text(data.nick).font(.title2.weight(.semibold))
                    Image(systemName: data.locked ? "lock.fill" : "lock.open.fill")
                        .font(.subheadline).foregroundStyle(data.locked ? Color.secondary : .orange)
                }
                Text("\(data.pct)%").font(.system(size: 44, weight: .medium, design: .rounded)).monospacedDigit()
                Text("\(data.range) mi").font(.title3).foregroundStyle(.secondary)
                if provider.availability != .online {
                    Label("Last reported", systemImage: "clock.arrow.circlepath").font(.callout).foregroundStyle(
                        .secondary)
                } else if data.isInGear {
                    Label(data.driveLabel ?? "In gear", systemImage: "steeringwheel").font(.callout)
                } else if data.charging {
                    Label("\(data.rate.formatted()) kW", systemImage: "bolt.fill").font(.callout).foregroundStyle(
                        .green)
                }
            }
            Image("EveeModelY").resizable().scaledToFit().accessibilityHidden(true)
                .frame(maxWidth: .infinity)
        }.padding(28).frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
