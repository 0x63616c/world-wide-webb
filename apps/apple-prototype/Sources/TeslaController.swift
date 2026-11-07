import SwiftUI

/// A stable car + energy composition. Only exceptions add a message to the main view.
struct TeslaController: View {
    let provider: any TeslaProvider
    var lockAction: (() -> Void)? = nil
    var busy = false
    var commandNotice: String? = nil
    @Environment(\.dynamicTypeSize) private var typeSize
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @ScaledMetric(relativeTo: .largeTitle) private var nameSize = 48.0

    private var data: TeslaData { provider.data }
    private var reported: Bool { provider.availability != .online }

    var body: some View {
        GeometryReader { geometry in
            let wide = geometry.size.width >= 900 && !typeSize.isAccessibilitySize
            ScrollView {
                VStack(alignment: .leading, spacing: wide ? 28 : 20) {
                    header
                    let layout = wide ? AnyLayout(HStackLayout(alignment: .center, spacing: 56))
                        : AnyLayout(VStackLayout(spacing: 24))
                    layout {
                        vehicle
                            .frame(maxWidth: wide ? 520 : 420)
                        dashboard
                            .frame(width: wide ? 380 : nil)
                    }
                }
                .padding(wide ? 48 : 24)
                .frame(maxWidth: 1080)
                .frame(minHeight: geometry.size.height, alignment: .center)
                .frame(maxWidth: .infinity)
            }
        }
        .animation(reduceMotion ? nil : .smooth(duration: 0.3), value: data.chargingState)
        .animation(reduceMotion ? nil : .smooth(duration: 0.3), value: data.softwareUpdate?.status)
        .accessibilityIdentifier("tesla-dashboard")
    }

    private var header: some View {
        HStack(alignment: .center) {
            VStack(alignment: .leading, spacing: 4) {
                Text(data.nick).font(.system(size: nameSize, weight: .bold, design: .rounded))
            }
            Spacer(minLength: 16)
            lockControl
            if reported || data.isInGear || !data.locked {
                TeslaStatus(data: data, reported: reported)
            }
        }
    }

    private var vehicle: some View {
        VStack(spacing: 20) {
            Image("EveeModelY")
                .resizable().scaledToFit()
                .accessibilityLabel("Evee, a Space Gray Model Y with white interior")
            if let commandNotice {
                Text(commandNotice).font(.callout).foregroundStyle(.secondary)
                    .accessibilityIdentifier("tesla-command-notice")
            }
        }
    }

    @ViewBuilder private var lockControl: some View {
        if let lockAction {
            Button(action: lockAction) {
                HStack(spacing: 12) {
                    if busy { ProgressView().controlSize(.small) }
                    else {
                        Image(systemName: data.locked ? "lock.fill" : "lock.open.fill")
                            .contentTransition(.symbolEffect(.replace))
                    }
                    Text(data.locked ? "Unlock" : "Lock")
                }
                .font(.title3.weight(.semibold))
                .frame(minWidth: 132, minHeight: 44).padding(.horizontal, 16)
            }
            .buttonStyle(.glass).controlSize(.large)
            .disabled(busy || reported || data.isInGear || data.isInstalling)
            .accessibilityLabel(data.locked ? "Unlock Evee" : "Lock Evee")
            .accessibilityValue(data.locked ? "Locked" : "Unlocked")
            .accessibilityHint("Requires the panel PIN")
            .accessibilityIdentifier("tesla-door-lock")
        }
    }

    private var dashboard: some View {
        VStack(alignment: .leading, spacing: 24) {
            TeslaEnergy(data: data, reported: reported)
            HStack(alignment: .top, spacing: 28) {
                VStack(alignment: .leading, spacing: 5) {
                    Text("\(data.odo) mi").font(.title3.weight(.medium)).monospacedDigit()
                    Text("Odometer").font(.caption).foregroundStyle(.secondary)
                }.accessibilityElement(children: .combine)
                    .accessibilityIdentifier("tesla-odometer")
                Spacer(minLength: 0)
                VStack(alignment: .trailing, spacing: 5) {
                    Text("\(data.climate)°F").font(.title3.weight(.medium)).monospacedDigit()
                    Text("Cabin").font(.caption).foregroundStyle(.secondary)
                }.accessibilityElement(children: .combine)
                    .accessibilityValue(data.preconditioning ? "Climate on" : "Climate off")
            }
            if let update = data.softwareUpdate, update.status == "available" || update.status == "installing" {
                TeslaUpdateNotice(update: update, reported: reported)
                    .transition(.opacity)
            }
        }
    }
}

private struct TeslaStatus: View {
    let data: TeslaData
    let reported: Bool
    var body: some View {
        Label(title, systemImage: symbol)
            .font(.headline)
            .foregroundStyle(reported ? Color.secondary : data.isInGear ? .cyan : !data.locked ? .orange : .primary)
            .padding(.horizontal, 16).padding(.vertical, 12)
            .background(.quaternary, in: .capsule)
            .accessibilityIdentifier(reported ? "tesla-last-known" : "tesla-status")
    }
    private var title: String {
        if reported { return "Last reported" }
        if data.isInstalling { return "Updating" }
        if data.isInGear, let drive = data.driveLabel { return drive }
        if !data.locked { return "Unlocked" }
        if let drive = data.driveLabel { return drive }
        return data.locked ? "Locked" : "Unlocked"
    }
    private var symbol: String {
        if reported { return "clock.arrow.circlepath" }
        if data.isInstalling { return "arrow.triangle.2.circlepath" }
        if data.isInGear { return "steeringwheel" }
        return data.locked ? "lock.fill" : "lock.open.fill"
    }
}
