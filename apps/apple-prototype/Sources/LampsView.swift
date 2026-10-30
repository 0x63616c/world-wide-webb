import SwiftUI

struct LampsController: View {
    let store: any HomeDataSource
    @State private var showingEffects = false
    @Environment(\.horizontalSizeClass) private var sizeClass
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    private var compact: Bool { sizeClass == .compact }
    var body: some View {
        let layout = compact ? AnyLayout(VStackLayout(spacing: 32)) : AnyLayout(HStackLayout(alignment: .top, spacing: 120))
        ScrollView {
            GlassEffectContainer(spacing: 16) {
            layout {
                VStack(spacing: 24) {
                    VStack(spacing: 4) {
                        Text("Global brightness").font(.system(size: compact ? 22 : 28, weight: .semibold))
                        Text("\(store.lamps.brightness)%")
                            .font(.system(size: compact ? 72 : 104, weight: .regular, design: .rounded)).monospacedDigit()
                            .contentTransition(.numericText()).accessibilityIdentifier("lamp-brightness-value")
                            .animation(reduceMotion ? nil : .smooth(duration: 0.25), value: store.lamps.brightness)
                        Text(store.lamps.anyOn ? "All 8 lamps · Both rooms" : "Turn on lamps to adjust")
                            .font(.system(size: compact ? 17 : 22)).foregroundStyle(.secondary)
                    }
                    LampBrightness(store: store).frame(width: compact ? 156 : 224, height: compact ? 300 : 460)
                    Text("Adjusting turns all lamps on").font(.system(size: compact ? 15 : 20)).foregroundStyle(.secondary)
                }.frame(width: compact ? nil : 340)
                VStack(alignment: .leading, spacing: 24) {
                    Text("Rooms").font(.system(size: compact ? 22 : 28, weight: .semibold))
                    room(.bedroom)
                    room(.livingRoom)
                    Button { showingEffects = true } label: {
                        Label("Color & Effects", systemImage: "paintpalette.fill")
                            .font(.system(size: compact ? 18 : 24, weight: .medium)).frame(maxWidth: .infinity).padding(.vertical, 18)
                    }.buttonStyle(.glass).accessibilityIdentifier("color-effects").padding(.top, 12)
                }.frame(width: compact ? nil : 460)
            }.padding(compact ? 24 : 40).frame(maxWidth: .infinity)
            }
        }.scrollIndicators(.hidden)
            .sheet(isPresented: $showingEffects) {
                ScrollView {
                    VStack(spacing: 28) {
                        HStack {
                            Text("Color & Effects").font(.title2.bold())
                            Spacer()
                            CircleButton(symbol: "xmark", label: "Close Color & Effects", size: 48) { showingEffects = false }
                        }
                        Text("All lamps").foregroundStyle(.secondary)
                        LampEffectsView(store: store)
                    }.padding(24).frame(maxWidth: 600)
                }.presentationSizing(.fitted).preferredColorScheme(.dark)
            }
    }
    private func room(_ key: Accessory) -> some View {
        let on = store.lamps.isOn(key)
        return VStack(alignment: .leading, spacing: 0) {
            Button { store.send(.toggle(key)) } label: {
                HStack(spacing: 24) {
                    Image(systemName: key.symbol).symbolRenderingMode(.hierarchical)
                        .font(.system(size: compact ? 38 : 48)).foregroundStyle(on ? .orange : .secondary)
                        .frame(width: 72, height: 84)
                        .background { LampGlow(on: on, brightness: store.lamps.brightness).frame(width: 150, height: 150) }
                    VStack(alignment: .leading, spacing: 8) {
                        Text(key.name).font(.system(size: compact ? 21 : 28, weight: .semibold))
                        Text(on ? "On · \(store.lamps.onCount(key)) of \(LampState.members(key).count) lamps" : "Off").font(.system(size: compact ? 16 : 22)).foregroundStyle(.secondary)
                    }
                    Spacer()
                    Image(systemName: "power").font(.system(size: 24)).foregroundStyle(on ? .orange : .secondary)
                }.padding(24)
            }.buttonStyle(.plain)
                .accessibilityLabel("Toggle \(key.name)").accessibilityValue(on ? "On" : "Off")
                .accessibilityIdentifier("controller-toggle-\(key.rawValue)")
            DisclosureGroup("Show lamps") {
                ForEach(Array(LampState.members(key)), id: \.self) { index in
                    HStack { Text(LampState.names[index]); Spacer(); Text(store.lamps.on[index] ? "On" : "Off").foregroundStyle(.secondary) }
                        .padding(.vertical, 4)
                }
            }.font(.system(size: compact ? 15 : 19)).foregroundStyle(.secondary)
                .padding(.horizontal, 24).padding(.bottom, 20)
        }.homeGlass(radius: 32)
    }
}

struct LampBrightness: View {
    let store: any HomeDataSource
    var body: some View {
        GeometryReader { proxy in
            let enabled = store.lamps.anyOn
            ZStack(alignment: .bottom) {
                Color.white.opacity(0.10)
                Rectangle().fill(.white)
                    .frame(height: proxy.size.height * Double(store.lamps.brightness) / 100)
                Image(systemName: "sun.max.fill").font(.system(size: 44, weight: .medium))
                    .foregroundStyle(store.lamps.brightness > 14 ? .black : .white)
                    .frame(maxWidth: .infinity).padding(.bottom, 34)
            }
            .clipShape(ConcentricRectangle())
            .containerShape(.rect(cornerRadius: 66))
            .shadow(color: .black.opacity(0.27), radius: 30, y: 18)
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
    @Environment(\.horizontalSizeClass) private var sizeClass
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
            }.padding(24).frame(width: sizeClass == .compact ? nil : 440)
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
