import SwiftUI

struct CompactController: View {
    let tile: HomeTile
    let store: any HomeDataSource
    let close: () -> Void
    var body: some View {
        switch tile {
        case .lamps, .bedroom, .livingRoom: LampsController(store: store)
        case .tesla: TeslaController(provider: store.tesla)
        case .wifi: WifiController(wifi: store.wifi)
        case .sound: NowPlayingView(store: store, close: close)
        case .climate:
            Form {
                Section {
                    Text("Inside \(store.climate.ambient)° · \(store.climate.action)")
                    Picker("Mode", selection: Binding(get: { store.climate.mode }, set: { store.send(.mode($0)) })) {
                        ForEach(ClimateMode.allCases, id: \.self) { Text($0.label).tag($0) }
                    }
                    if store.climate.mode == .heatCool {
                        Stepper("Heat to \(store.climate.low)°", onIncrement: { store.send(.low(store.climate.low + 1)) }, onDecrement: { store.send(.low(store.climate.low - 1)) })
                        Stepper("Cool to \(store.climate.high)°", onIncrement: { store.send(.high(store.climate.high + 1)) }, onDecrement: { store.send(.high(store.climate.high - 1)) })
                    } else if store.climate.mode != .off {
                        Stepper("Set to \(store.climate.target)°", onIncrement: { store.send(.target(store.climate.target + 1)) }, onDecrement: { store.send(.target(store.climate.target - 1)) })
                    }
                    Button("Fan · \(store.climate.fanLabel)") { store.send(.toggle(.fan)) }
                }
            }.scrollContentBackground(.hidden)
        case .all, .fan, .lights, .ceiling, .cabinet:
            Form {
                ForEach([Accessory.all, .fan, .lamps, .lights, .bedroom, .livingRoom, .ceiling, .cabinet]) { key in
                    Button { store.send(.toggle(key)) } label: {
                        HStack { Label(key.name, systemImage: key.symbol); Spacer(); Text(key == .fan ? store.climate.fanLabel : store.lamps.isOn(key) ? "On" : "Off").foregroundStyle(.secondary) }
                    }
                }
            }.scrollContentBackground(.hidden)
        case .weather, .hourly:
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    WeatherTile(weather: store.weather).frame(height: 380)
                    ForEach(store.weather.hours) { hour in
                        HStack { Text(hour.time); Spacer(); Image(systemName: hour.symbol); Text("\(hour.temperature)°") }.font(.title3)
                    }
                }.padding(24)
            }
        case .calendar, .media, .sonosRooms, .cameras, .photos, .dogwalk: ModulePage(tile: tile, store: store, close: close)
        case .clock, .alarm: ClockController(store: store)
        }
    }
}
