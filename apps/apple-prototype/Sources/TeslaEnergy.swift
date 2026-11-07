import SwiftUI
import PanelKit

struct TeslaEnergy: View {
    let data: TeslaData
    let reported: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @ScaledMetric(relativeTo: .largeTitle) private var chargeSize = 64.0
    private var active: Bool { data.charging && !data.isInGear && !reported }
    private var tint: Color { reported ? .secondary : active ? .green : data.pct <= 20 ? .orange : .primary }

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            HStack(alignment: .firstTextBaseline) {
                Text("\(data.pct)%")
                    .font(.system(size: chargeSize, weight: .medium, design: .rounded))
                    .monospacedDigit().contentTransition(.numericText())
                    .accessibilityLabel("Battery, \(data.pct) percent")
                Spacer(minLength: 12)
                VStack(alignment: .trailing, spacing: 4) {
                    Text("\(data.range) mi").font(.title2.weight(.medium)).monospacedDigit()
                }.accessibilityElement(children: .ignore)
                    .accessibilityLabel("Estimated range, \(data.range) miles")
            }
            TeslaChargeBar(percent: data.pct, active: active, tint: tint)
            if active {
                HStack(spacing: 10) {
                    Image(systemName: "bolt.fill")
                    Text("\(data.rate.formatted()) kW").monospacedDigit()
                        .accessibilityLabel("Charging at \(data.rate.formatted()) kilowatts")
                    Spacer(minLength: 8)
                    if let limit = data.chargeLimitPercent {
                        if let finish = data.chargeCompleteAt, finish > Date() {
                            Text("\(Int(limit.rounded()))% by \(finish, format: .dateTime.hour().minute())")
                                .font(.subheadline).foregroundStyle(.secondary)
                        } else {
                            Text("To \(Int(limit.rounded()))%").font(.subheadline).foregroundStyle(.secondary)
                        }
                    }
                }.foregroundStyle(.green)
            } else if data.chargingState != "disconnected" {
                Label(data.chargeLabel, systemImage: data.chargingState == "no_power" ? "exclamationmark.triangle.fill" : "ev.plug.dc.ccs1")
                    .font(.callout).foregroundStyle(.secondary)
            }
        }
        .animation(reduceMotion ? nil : .smooth(duration: 0.3), value: data.pct)
        .accessibilityIdentifier("tesla-energy")
    }
}

struct TeslaUpdateNotice: View {
    let update: TeslaSoftwareUpdate
    let reported: Bool
    private var installing: Bool { update.status == "installing" }
    var body: some View {
        HStack(spacing: 14) {
            if installing && !reported { ProgressView().controlSize(.small) }
            else { Image(systemName: "arrow.down.circle.fill").font(.title2).foregroundStyle(.blue) }
            VStack(alignment: .leading, spacing: 5) {
                Text(installing ? "Installing update" : "Update available").font(.headline)
                if let version = update.latestVersion { Text(version).font(.subheadline).foregroundStyle(.secondary) }
            }
            Spacer(minLength: 0)
        }
        .padding(20).background(.blue.opacity(0.10), in: .rect(cornerRadius: 24))
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("tesla-update")
    }
}
