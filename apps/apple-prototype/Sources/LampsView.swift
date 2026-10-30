import SwiftUI

struct LampsController: View {
    let store: any HomeDataSource
    @State private var showingEffects = false
    var body: some View {
        HStack(alignment: .center, spacing: 100) {
            HStack(spacing: 42) {
                LampBrightness(store: store)
                    .frame(width: 220, height: 560)
                VStack(alignment: .leading, spacing: 12) {
                    HStack(alignment: .firstTextBaseline, spacing: 2) {
                        Text("\(store.lamps.brightness)").font(.system(size: 116, weight: .thin)).monospacedDigit()
                        Text("%").font(.system(size: 44, weight: .light)).opacity(0.7)
                    }.accessibilityIdentifier("lamp-brightness-value")
                    Text("All lamps").font(.system(size: 28, weight: .semibold))
                    Text(store.lamps.anyOn ? "Brightness" : "Turn on lamps to adjust")
                        .font(.system(size: 20)).foregroundStyle(.white.opacity(0.65))
                    // The real command turns on every lamp, including an off room.
                    Text("Applies to both rooms")
                        .font(.system(size: 17)).foregroundStyle(.white.opacity(0.6)).padding(.top, 6)
                }.frame(width: 254, alignment: .leading)
            }
            VStack(spacing: 48) {
                HStack(alignment: .top, spacing: 36) {
                    room(.bedroom, members: "Bed Left · Bed Right\nMirror")
                    room(.livingRoom, members: "Globe · Corner Lamp\nFloor Lamp · Desk\nKitchen Lamp")
                }
                Button { showingEffects = true } label: {
                    Label("Color & Effects", systemImage: "paintpalette.fill")
                        .font(.system(size: 24, weight: .semibold))
                        .padding(.horizontal, 26).frame(height: 70)
                }.buttonStyle(.plain).faceGlass(radius: 35).accessibilityIdentifier("color-effects")
            }.frame(width: 400)
        }.frame(maxWidth: .infinity, maxHeight: .infinity)
            .sheet(isPresented: $showingEffects) {
                VStack(spacing: 28) {
                    HStack {
                        VStack(alignment: .leading, spacing: 6) {
                            Text("Color & Effects").font(.system(size: 28, weight: .semibold))
                            Text("All lamps").font(.system(size: 20)).foregroundStyle(.white.opacity(0.65))
                        }
                        Spacer()
                        CircleButton(symbol: "xmark", label: "Close Color & Effects", size: 48, clearGlass: true) { showingEffects = false }
                    }
                    LampEffectsView(store: store)
                }.padding(36).frame(width: 600)
                    .presentationSizing(.fitted)
                    .presentationBackground(Palette.amber)
                    .foregroundStyle(.white).tint(.white)
                    .environment(\.colorScheme, .dark)
            }
    }
    private func room(_ key: Accessory, members: String) -> some View {
        let on = store.lamps.isOn(key)
        return VStack(spacing: 12) {
            Button { store.send(.toggle(key)) } label: {
                Image(systemName: key.symbol).font(.system(size: 49))
                    .foregroundStyle(on ? Color(hex: "#cc8908") : .white)
                    .frame(width: 132, height: 132)
                    .faceGlass(on: on, radius: 66)
                    .overlay { if store.pending.contains(key.rawValue) { ProgressView().tint(on ? Palette.ink : .white) } }
            }.buttonStyle(.plain)
                .accessibilityLabel("Toggle \(key.name)")
                .accessibilityValue(on ? "On" : "Off")
                .accessibilityIdentifier("controller-toggle-\(key.rawValue)")
            Text(key.name).font(.system(size: 24, weight: .semibold))
            Text(on ? "On" : "Off").font(.system(size: 20)).opacity(0.65)
            Text(members).font(.system(size: 16)).foregroundStyle(.white.opacity(0.55))
                .multilineTextAlignment(.center).lineSpacing(5).padding(.top, 8)
        }.frame(width: 182)
    }
}

struct LampBrightness: View {
    let store: any HomeDataSource
    var body: some View {
        GeometryReader { proxy in
            let enabled = store.lamps.anyOn
            ZStack(alignment: .bottom) {
                RoundedRectangle(cornerRadius: 66, style: .continuous)
                    .fill(.white.opacity(0.08))
                    .glassEffect(.clear, in: .rect(cornerRadius: 66, style: .continuous))
                Rectangle().fill(.white)
                    .frame(height: proxy.size.height * Double(store.lamps.brightness) / 100)
                Image(systemName: "sun.max.fill").font(.system(size: 44, weight: .medium))
                    .foregroundStyle(store.lamps.brightness > 14 ? Palette.amber : .white.opacity(0.7))
                    .frame(maxWidth: .infinity).padding(.bottom, 34)
            }
            .clipShape(RoundedRectangle(cornerRadius: 66, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 66, style: .continuous)
                .strokeBorder(.white.opacity(0.4), lineWidth: 0.5))
            .shadow(color: .black.opacity(0.1), radius: 24, y: 12)
            .opacity(enabled ? 1 : 0.4)
            .contentShape(RoundedRectangle(cornerRadius: 66, style: .continuous))
            .gesture(DragGesture(minimumDistance: 0).onChanged { value in
                guard enabled else { return }
                store.send(.brightness(Int((100 * (1 - value.location.y / proxy.size.height)).rounded())))
            })
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("All lamps brightness")
            .accessibilityValue("\(store.lamps.brightness)%")
            .accessibilityHint(enabled ? "Adjusts every lamp in both rooms" : "Turn on lamps to adjust")
            .accessibilityIdentifier("lamp-brightness")
            .accessibilityAdjustableAction { direction in
                guard enabled else { return }
                switch direction {
                case .increment: store.send(.brightness(store.lamps.brightness + 5))
                case .decrement: store.send(.brightness(store.lamps.brightness - 5))
                @unknown default: break
                }
            }
            .disabled(!enabled)
        }
    }
}

struct LampEffectsView: View {
    let store: any HomeDataSource
    @State private var editingSlot: Int?
    @State private var editingColors = false
    @State private var draftHex = ""
    var body: some View {
        VStack(alignment: .leading, spacing: 24) {
            SectionLabel(text: "Lamp scene")
            HStack(spacing: 16) {
                scene("White", colors: [Color(hex: "#ffe3b7"), .white])
                scene("Mood", colors: [Color(hex: "#a855f7"), Color(hex: "#3b82f6"), Color(hex: "#ec4899")])
            }
            VStack(spacing: 10) {
                HStack { SectionLabel(text: "White temperature"); Spacer(); Text("\(store.lamps.kelvin) K").font(.system(size: 22)) }
                Slider(value: Binding(get: { Double(store.lamps.kelvin) }, set: { store.send(.kelvin(Int($0))) }), in: 2000...6500, step: 100).accessibilityLabel("White temperature")
                HStack { Text("2000 K"); Spacer(); Text("6500 K") }.font(.system(size: 15)).opacity(0.6)
            }.disabled(!store.lamps.anyOn).opacity(store.lamps.anyOn ? 1 : 0.4)
            HStack {
                SectionLabel(text: "Colors"); Spacer()
                Button(editingColors ? "Done" : "Edit") { editingColors.toggle() }.buttonStyle(.glass)
            }
            HStack(spacing: 28) {
                ForEach(0..<3) { slot in
                    Button {
                        if editingColors { draftHex = store.lamps.colors[slot]; editingSlot = slot }
                        else { store.send(.color(slot, nil)) }
                    } label: {
                        VStack(spacing: 12) {
                            Circle().fill(Color(hex: store.lamps.colors[slot])).frame(width: 72, height: 72)
                                .overlay(Circle().strokeBorder(.white.opacity(0.9), lineWidth: store.lamps.activeColor == slot ? 4 : 1))
                                .overlay { if editingColors { Image(systemName: "pencil").font(.system(size: 24)) } }
                            Text("Custom \(slot + 1)").font(.system(size: 17, weight: .medium))
                        }.frame(maxWidth: .infinity)
                    }.buttonStyle(.plain).accessibilityLabel("\(editingColors ? "Edit" : "Use") Custom \(slot + 1)")
                }
            }
            SectionLabel(text: "Party")
            HStack(spacing: 12) {
                ForEach(PartySpeed.allCases, id: \.self) { speed in
                    Choice(title: speed.rawValue, selected: store.lamps.party == speed) { store.send(.party(speed)) }
                }
            }.disabled(!store.lamps.anyOn).opacity(store.lamps.anyOn ? 1 : 0.4)
        }.frame(maxWidth: .infinity)
        .sheet(isPresented: Binding(get: { editingSlot != nil }, set: { if !$0 { editingSlot = nil } })) {
            VStack(alignment: .leading, spacing: 24) {
                Text("Edit Custom \((editingSlot ?? 0) + 1)").font(.system(size: 28, weight: .semibold))
                RoundedRectangle(cornerRadius: 24).fill(Color(hex: draftHex)).frame(height: 120)
                TextField("Hex color", text: $draftHex).textFieldStyle(.roundedBorder).font(.system(size: 24)).accessibilityLabel("Hex color")
                Text("Use a six-digit hex color, such as #0066ff.").foregroundStyle(.secondary)
                HStack {
                    Button("Cancel") { editingSlot = nil }.keyboardShortcut(.cancelAction)
                    Spacer()
                    Button("Save & use") {
                        if let slot = editingSlot { store.send(.color(slot, draftHex)) }; editingSlot = nil
                    }.disabled(draftHex.range(of: "^#[0-9A-Fa-f]{6}$", options: .regularExpression) == nil).keyboardShortcut(.defaultAction)
                }.buttonStyle(.glass)
            }.padding(32).frame(width: 440)
        }
    }
    private func scene(_ name: String, colors: [Color]) -> some View {
        Button { store.send(.scene(name)) } label: {
            HStack(spacing: 12) {
                Circle().fill(LinearGradient(colors: colors, startPoint: .topLeading, endPoint: .bottomTrailing)).frame(width: 32, height: 32)
                Text(name).font(.system(size: 21, weight: .semibold))
                Spacer()
                if store.lamps.scene == name && store.lamps.party == .off { Image(systemName: "checkmark") }
            }.padding(17)
        }.buttonStyle(.glass)
    }
}
