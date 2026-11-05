import SwiftUI

struct ControlsController: View {
    let store: any HomeDataSource
    var fanIsOn: Bool? = nil
    @Environment(\.horizontalSizeClass) private var sizeClass
    @State private var previewBrightness: Int?
    var body: some View {
        GeometryReader { geometry in
            ScrollView {
                VStack(alignment: .leading, spacing: 36) {
                    HStack(alignment: .center) {
                        VStack(alignment: .leading, spacing: 8) {
                            Text("Lights").font(.system(size: 44, weight: .semibold))
                            Text(store.lamps.anyOn ? "\(store.lamps.onCount()) lamps on" : "Lamps are off")
                                .font(.title3).foregroundStyle(.secondary)
                        }
                        Spacer()
                        Button { store.send(.toggle(.all)) } label: {
                            Label(store.lamps.isOn(.all) ? "Turn all off" : "Turn all on", systemImage: "power")
                                .font(.title3.weight(.medium)).padding(10)
                        }.buttonStyle(.glass).tint(.orange).accessibilityIdentifier("lights-all-power")
                    }
                    if sizeClass == .compact {
                        rooms
                        lampControls
                    } else {
                        HStack(alignment: .top, spacing: 40) {
                            rooms.frame(width: 360)
                            lampControls.frame(maxWidth: .infinity)
                        }
                    }
                }.padding(sizeClass == .compact ? 24 : 48)
                    .frame(minHeight: geometry.size.height, alignment: .top)
            }.scrollIndicators(.hidden)
        }.background(Color.black)
    }
    private var rooms: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Rooms & fixtures").font(.title3.weight(.semibold)).padding(.bottom, 8)
            ForEach([Accessory.bedroom, .livingRoom, .ceiling, .cabinet]) { key in
                let on = store.lamps.isOn(key)
                Button { store.send(.toggle(key)) } label: {
                    HStack(spacing: 20) {
                        Image(systemName: key.symbol).font(.system(size: 30)).frame(width: 48)
                            .foregroundStyle(on ? .orange : .secondary)
                        VStack(alignment: .leading, spacing: 7) {
                            Text(key == .bedroom ? "Bedroom" : key == .livingRoom ? "Living room" : key.name)
                                .font(.title3.weight(.semibold))
                            Text(on ? (LampState.members(key).isEmpty ? "On" : store.lamps.countLabel(key)) : "Off")
                                .font(.body).foregroundStyle(.secondary)
                        }
                        Spacer(minLength: 8)
                        Image(systemName: "power").font(.title3).foregroundStyle(on ? .orange : .secondary)
                    }.padding(24).frame(maxWidth: .infinity, minHeight: 116, alignment: .leading)
                        .background(on ? Color.orange.opacity(0.12) : Color(white: 0.075), in: .rect(cornerRadius: 26))
                        .contentShape(.rect(cornerRadius: 26))
                }.buttonStyle(.plain).accessibilityLabel("Toggle \(key.name)")
                    .accessibilityIdentifier("controller-toggle-\(key.rawValue)").accessibilityValue(on ? "On" : "Off")
            }
        }
    }
    private var lampControls: some View {
        VStack(alignment: .leading, spacing: 32) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 8) {
                    Text("All lamps").font(.title2.weight(.semibold))
                    Text("Brightness & colour").font(.body).foregroundStyle(.secondary)
                }
                Spacer()
                Text("\(previewBrightness ?? store.lamps.brightness)%")
                    .font(.system(size: 64, weight: .regular, design: .rounded)).monospacedDigit()
                    .accessibilityIdentifier("lamp-brightness-value")
            }
            FilledLevelControl(value: store.lamps.brightness, label: "Lamp brightness", symbol: "sun.max.fill",
                preview: { previewBrightness = $0 }) { store.send(.brightness($0)) }
                .frame(height: 84).disabled(!store.lamps.anyOn).accessibilityIdentifier("lamp-brightness")
            LampEffectsView(store: store)
        }.padding(32).background(Color(white: 0.06), in: .rect(cornerRadius: 32))
    }
}
