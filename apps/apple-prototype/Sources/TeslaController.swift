import SwiftUI

/// A read-only vehicle summary; exceptions add information only when needed.
struct TeslaController: View {
    let provider: any TeslaProvider
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @ScaledMetric(relativeTo: .largeTitle) private var nameSize = 40.0

    private var data: TeslaData { provider.data }
    private var reported: Bool { provider.availability != .online }

    var body: some View {
        GeometryReader { geometry in
            ScrollView {
                VStack(spacing: 28) {
                    header
                    Image("EveeModelY")
                        .resizable().scaledToFit()
                        .frame(maxWidth: 560)
                        .accessibilityLabel("Evee, a Space Gray Model Y with white interior")
                    TeslaEnergy(data: data, reported: reported)
                    Label("\(data.climate)°F", systemImage: data.preconditioning ? "fan.fill" : "thermometer.medium")
                        .font(.title3).foregroundStyle(.secondary)
                        .accessibilityLabel("Cabin temperature, \(data.climate) degrees Fahrenheit")
                        .accessibilityValue(data.preconditioning ? "Climate on" : "Climate off")
                    if let update = data.softwareUpdate, update.status == "available" || update.status == "installing" {
                        TeslaUpdateNotice(update: update, reported: reported)
                            .transition(.opacity)
                    }
                }
                .padding(32)
                .frame(maxWidth: 660)
                .frame(minHeight: geometry.size.height, alignment: .center)
                .frame(maxWidth: .infinity)
            }
        }
        .animation(reduceMotion ? nil : .smooth(duration: 0.3), value: data.chargingState)
        .animation(reduceMotion ? nil : .smooth(duration: 0.3), value: data.softwareUpdate?.status)
        .accessibilityIdentifier("tesla-dashboard")
    }

    private var header: some View {
        VStack(spacing: 8) {
            HStack(spacing: 12) {
                Text(data.nick).font(.system(size: nameSize, weight: .semibold, design: .rounded))
                Image(systemName: data.locked ? "lock.fill" : "lock.open.fill")
                    .font(.title3)
                    .foregroundStyle(!data.locked && !reported ? Color.orange : .secondary)
                    .contentTransition(.symbolEffect(.replace))
                    .accessibilityLabel(reported ? "Last reported lock state" : "Door lock")
                    .accessibilityValue(data.locked ? "Locked" : "Unlocked")
                    .accessibilityIdentifier("tesla-lock-status")
            }
            Text("\(data.odo) mi").font(.callout).monospacedDigit().foregroundStyle(.secondary)
                .accessibilityLabel("Odometer, \(data.odo) miles")
                .accessibilityIdentifier("tesla-odometer")
            if reported {
                Label("Last reported", systemImage: "clock.arrow.circlepath")
                    .font(.callout).foregroundStyle(.secondary)
                    .accessibilityIdentifier("tesla-last-known")
            } else if data.isInGear {
                Label(data.driveLabel ?? "In gear", systemImage: "steeringwheel")
                    .font(.callout).foregroundStyle(.cyan)
                    .accessibilityIdentifier("tesla-status")
            }
        }
    }
}
