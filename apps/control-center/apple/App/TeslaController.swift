import Charts
import PanelKit
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
                Group {
                    if geometry.size.width >= 900 {
                        HStack(alignment: .center, spacing: 48) {
                            vehicle
                            TeslaMileageView(provider: provider)
                        }
                        .frame(maxWidth: 1200)
                    } else {
                        VStack(spacing: 36) {
                            vehicle
                            TeslaMileageView(provider: provider)
                        }
                        .frame(maxWidth: 660)
                    }
                }
                .padding(32)
                .frame(minHeight: geometry.size.height, alignment: .center)
                .frame(maxWidth: .infinity)
            }
        }
        .animation(reduceMotion ? nil : .smooth(duration: 0.3), value: data.chargingState)
        .animation(reduceMotion ? nil : .smooth(duration: 0.3), value: data.softwareUpdate?.status)
        .accessibilityIdentifier("tesla-dashboard")
    }

    private var vehicle: some View {
        VStack(spacing: 28) {
            header
            Image("EveeModelY")
                .resizable().scaledToFit()
                .frame(maxWidth: 560)
                .accessibilityLabel("Evee, a Space Gray Model Y")
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
        .frame(maxWidth: .infinity)
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .center, spacing: 12) {
                Text(data.nick).font(.system(size: nameSize, weight: .semibold, design: .rounded))
                Image(systemName: data.locked ? "lock.fill" : "lock.open.fill")
                    .font(.title3)
                    .foregroundStyle(!data.locked && !reported ? Color.orange : .secondary)
                    .contentTransition(.symbolEffect(.replace))
                    .accessibilityLabel(reported ? "Last reported lock state" : "Door lock")
                    .accessibilityValue(data.locked ? "Locked" : "Unlocked")
                    .accessibilityIdentifier("tesla-lock-status")
                Spacer(minLength: 16)
                Text("\(data.odo) mi").font(.callout).monospacedDigit().foregroundStyle(.secondary)
                    .accessibilityLabel("Odometer, \(data.odo) miles")
                    .accessibilityIdentifier("tesla-odometer")
            }
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

private struct TeslaMileageView: View {
    let provider: any TeslaProvider
    @State private var points: [TeslaMileagePoint] = []
    @State private var loading = true
    @State private var failed = false
    @State private var selected: Date?

    private var selectedPoint: TeslaMileagePoint? {
        guard let selected else { return nil }
        return points.min { abs($0.date.timeIntervalSince(selected)) < abs($1.date.timeIntervalSince(selected)) }
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Mileage").font(.title2.weight(.semibold))
            if loading {
                ProgressView().frame(maxWidth: .infinity, minHeight: 230)
            } else if failed {
                VStack(alignment: .leading, spacing: 12) {
                    Text("Mileage history unavailable").foregroundStyle(.secondary)
                    Button("Try again") { Task { await load() } }
                }.frame(maxWidth: .infinity, minHeight: 230, alignment: .leading)
            } else if points.isEmpty {
                Text("No mileage history yet").foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, minHeight: 230, alignment: .leading)
            } else {
                if let point = selectedPoint ?? points.last {
                    Text("\(Int(point.miles.rounded()).formatted()) mi")
                        .font(.title.weight(.medium)).monospacedDigit()
                    Text(point.date, format: .dateTime.month(.abbreviated).day().year())
                        .font(.callout).foregroundStyle(.secondary)
                }
                Chart(points) { point in
                    LineMark(x: .value("Date", point.date), y: .value("Odometer (miles)", point.miles))
                        .foregroundStyle(.primary)
                }
                .chartYScale(domain: .automatic(includesZero: false))
                .chartXSelection(value: $selected)
                .frame(height: 230)
                .accessibilityLabel("Odometer history in miles")
                .accessibilityIdentifier("tesla-mileage-chart")
                Text("Hourly readings").font(.caption).foregroundStyle(.secondary)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .task { await load() }
    }
    private func load() async {
        loading = true
        do {
            points = try await provider.mileageHistory().sorted { $0.timestamp < $1.timestamp }
            failed = false
        } catch {
            failed = true
        }
        loading = false
    }
}
