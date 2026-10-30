import SwiftUI

/// Field names and value types mirror the retired features/tesla/service.ts contract.
struct TeslaData: Equatable {
    var name = "Model Y"
    var nick = "Car"
    var locked = true
    var place = "Home"
    var lat: Double? = nil
    var lon: Double? = nil
    var charging = true
    var chargingState = "charging"
    var preconditioning = false
    var rate: Double = 11
    var pct = 78
    var range = 241
    var odo = "12,480"
    var climate = 64
}
enum TeslaAvailability: String, CaseIterable { case online, asleep, offline }
enum TeslaCommand { case setLock(Bool), setCharging(Bool), setPreconditioning(Bool) }

@MainActor protocol TeslaProvider: AnyObject, Observable {
    var data: TeslaData { get }
    var availability: TeslaAvailability { get }
    func send(_ command: TeslaCommand)
}

@MainActor @Observable final class MockTeslaProvider: TeslaProvider {
    private(set) var data: TeslaData
    let availability: TeslaAvailability
    init(data: TeslaData = TeslaData(), availability: TeslaAvailability = .online) {
        self.data = data
        self.availability = availability
    }
    func send(_ command: TeslaCommand) {
        guard availability == .online else { return }
        switch command {
        case .setLock(let locked): data.locked = locked
        case .setCharging(let on):
            // A disconnected/no-power vehicle cannot begin a charge session.
            guard !on || !["disconnected", "no_power", ""].contains(data.chargingState) else { return }
            data.charging = on
            data.chargingState = on ? "charging" : "stopped"
            data.rate = on ? 11 : 0
        case .setPreconditioning(let on): data.preconditioning = on
        }
    }
}

struct TeslaTile: View {
    let provider: any TeslaProvider
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Image(systemName: "car.side.fill").font(.system(size: 30)).foregroundStyle(.secondary)
                Spacer()
                if provider.availability != .online {
                    Text(provider.availability.rawValue.capitalized).font(.system(size: 16, weight: .medium))
                        .padding(.horizontal, 10).padding(.vertical, 6).background(.quaternary, in: .capsule)
                } else { ChargingPulse(active: provider.data.charging).frame(width: 28, height: 28) }
            }
            HStack(alignment: .firstTextBaseline, spacing: 3) {
                Text("\(provider.data.pct)").font(.system(size: 84, weight: .regular, design: .rounded)).monospacedDigit()
                Text("%").font(.system(size: 32)).foregroundStyle(.secondary)
            }.contentTransition(.numericText())
            Text("\(provider.data.range) mi").font(.system(size: 26, weight: .medium))
            Text(provider.availability == .online ? (provider.data.charging ? "Charging · \(provider.data.rate.formatted()) kW" : provider.data.chargingState.replacingOccurrences(of: "_", with: " ").capitalized) : "Last reported charge")
                .font(.system(size: 20)).foregroundStyle(.secondary)
        }.padding(32).frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    }
}

struct TeslaChargeComplication: View {
    let provider: any TeslaProvider
    var accented = false
    var body: some View {
        VStack(spacing: 8) {
            Gauge(value: Double(provider.data.pct), in: 0...100) {
                Image(systemName: "bolt.fill")
            } currentValueLabel: {
                Text("\(provider.data.pct)").font(.system(size: 24, weight: .semibold, design: .rounded))
            }.gaugeStyle(.accessoryCircular).tint(accented ? .white : .green)
                .scaleEffect(1.5).frame(width: 92, height: 92)
            Text(provider.availability == .online ? "Car · \(provider.data.pct)%" : provider.availability.rawValue.capitalized)
                .font(.system(size: 20, weight: .medium))
        }.accessibilityElement(children: .ignore)
            .accessibilityLabel("Car charge \(provider.data.pct) percent, \(provider.availability.rawValue)")
    }
}

struct TeslaController: View {
    let provider: any TeslaProvider
    @Environment(\.horizontalSizeClass) private var sizeClass
    private var compact: Bool { sizeClass == .compact }
    var body: some View {
        ScrollView {
            VStack(spacing: compact ? 28 : 28) {
                VStack(spacing: 8) {
                    Image(systemName: "car.side.fill").font(.system(size: compact ? 44 : 64)).foregroundStyle(.secondary)
                    Text(provider.data.name).font(.system(size: compact ? 28 : 36, weight: .semibold))
                    Text(provider.data.place).font(.system(size: compact ? 17 : 24)).foregroundStyle(.secondary)
                }
                VStack(spacing: 12) {
                    HStack(alignment: .firstTextBaseline, spacing: 4) {
                        Text("\(provider.data.pct)").font(.system(size: compact ? 92 : 112, weight: .regular, design: .rounded)).monospacedDigit()
                        Text("%").font(.system(size: compact ? 36 : 48)).foregroundStyle(.secondary)
                    }
                    Gauge(value: Double(provider.data.pct), in: 0...100) { EmptyView() }
                        .gaugeStyle(.linearCapacity).tint(.green).labelsHidden()
                        .padding(.vertical, 8)
                    HStack {
                        Label(provider.data.chargingState.replacingOccurrences(of: "_", with: " ").capitalized, systemImage: provider.data.charging ? "bolt.fill" : "battery.75percent")
                        Spacer()
                        Text(provider.data.charging ? "\(provider.data.rate.formatted()) kW" : "\(provider.data.range) mi")
                    }.font(.system(size: compact ? 18 : 26, weight: .medium)).foregroundStyle(.green)
                    if provider.availability != .online {
                        Text("\(provider.availability.rawValue.capitalized) · Last reported values")
                            .foregroundStyle(.secondary)
                    } else {
                        Text("\(provider.data.range) mi range").foregroundStyle(.secondary)
                    }
                }
                VStack(spacing: 0) {
                    Toggle("Charging", isOn: Binding(get: { provider.data.charging }, set: { provider.send(.setCharging($0)) }))
                        .padding(.vertical, 18)
                    Divider()
                    HStack {
                        Label(provider.data.locked ? "Locked" : "Unlocked", systemImage: provider.data.locked ? "lock.fill" : "lock.open.fill")
                        Spacer()
                        Button(provider.data.locked ? "Unlock" : "Lock") { provider.send(.setLock(!provider.data.locked)) }
                            .buttonStyle(.glass).controlSize(.large)
                    }.padding(.vertical, 18)
                    Divider()
                    Toggle(isOn: Binding(get: { provider.data.preconditioning }, set: { provider.send(.setPreconditioning($0)) })) {
                        VStack(alignment: .leading, spacing: 6) {
                            Text("Precondition")
                            Text("Cabin · \(provider.data.climate)°F").font(.system(size: compact ? 15 : 20)).foregroundStyle(.secondary)
                        }
                    }.padding(.vertical, 18)
                }.font(.system(size: compact ? 20 : 28, weight: .medium))
                    .disabled(provider.availability != .online).tint(.green)
                HStack { Text("Odometer"); Spacer(); Text("\(provider.data.odo) mi").monospacedDigit() }
                    .font(.system(size: compact ? 16 : 22)).foregroundStyle(.secondary)
            }.frame(maxWidth: compact ? 600 : 680).padding(compact ? 24 : 32)
                .frame(maxWidth: .infinity)
        }
    }
}
