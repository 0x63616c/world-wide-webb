import SwiftUI

struct LampsController: View {
    let store: any HomeDataSource
    @State private var showingEffects = false
    @Environment(\.horizontalSizeClass) private var sizeClass
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    private var compact: Bool { sizeClass == .compact }
    var body: some View {
        ScrollView {
            GlassEffectContainer(spacing: 24) {
                VStack(spacing: 24) {
                    brightnessHeading
                    if compact {
                        LampBrightness(store: store).frame(width: 168, height: 320)
                        brightnessScope
                        room(.bedroom)
                        room(.livingRoom)
                    } else {
                        HStack(alignment: .center, spacing: 64) {
                            room(.bedroom).frame(width: 280)
                            LampBrightness(store: store).frame(width: 224, height: 384)
                            room(.livingRoom).frame(width: 280)
                        }
                        brightnessScope
                    }
                    Button { showingEffects = true } label: {
                        Label("All lamps · Color & Effects", systemImage: "paintpalette.fill")
                            .font(.system(size: compact ? 18 : 24, weight: .medium))
                            .frame(maxWidth: .infinity).frame(height: 64)
                    }.buttonStyle(.glass).accessibilityIdentifier("color-effects")
                        .frame(maxWidth: compact ? .infinity : 480)
                }.padding(compact ? 24 : 32).frame(maxWidth: .infinity)
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
    private var brightnessHeading: some View {
        VStack(spacing: 4) {
            Text("Global brightness").font(.system(size: compact ? 22 : 28, weight: .semibold))
            Text("\(store.lamps.brightness)%")
                .font(.system(size: compact ? 72 : 96, weight: .regular, design: .rounded)).monospacedDigit()
                .contentTransition(.numericText()).accessibilityIdentifier("lamp-brightness-value")
                .animation(reduceMotion ? nil : .smooth(duration: 0.25), value: store.lamps.brightness)
            Text("\(store.lamps.onCount(.lamps)) of 8 on").font(.system(size: 22, weight: .medium))
        }
    }
    private var brightnessScope: some View {
        Text(store.lamps.anyOn ? "Adjusting turns all 8 lamps on" : "Turn on lamps to adjust")
            .font(.system(size: compact ? 17 : 22)).foregroundStyle(.primary)
            .multilineTextAlignment(.center).fixedSize(horizontal: false, vertical: true)
    }
    private func room(_ key: Accessory) -> some View {
        let on = store.lamps.isOn(key)
        return VStack(alignment: .leading, spacing: 16) {
            HStack(spacing: 8) {
                Text(key.name).font(.system(size: 24, weight: .semibold))
                    .lineLimit(1).minimumScaleFactor(0.92)
                Spacer(minLength: 0)
                Toggle("Power", isOn: Binding(get: { store.lamps.isOn(key) }, set: { requested in
                    if store.lamps.isOn(key) != requested { store.send(.toggle(key)) }
                }))
                    .labelsHidden().toggleStyle(.switch).tint(.orange)
                    .accessibilityLabel("\(key.name) power")
                    .accessibilityIdentifier("controller-toggle-\(key.rawValue)")
            }.frame(minHeight: 64)
            HStack(spacing: 8) {
                Image(systemName: key.symbol).symbolRenderingMode(.hierarchical)
                    .font(.system(size: 28)).foregroundStyle(on ? .orange : .secondary)
                Text(on ? "On · \(store.lamps.onCount(key)) of \(LampState.members(key).count) lamps" : "Off · \(LampState.members(key).count) lamps")
                    .font(.system(size: 20)).foregroundStyle(.primary)
            }
            DisclosureGroup("Show lamps") {
                ForEach(Array(LampState.members(key)), id: \.self) { index in
                    HStack {
                        Text(LampState.names[index]); Spacer()
                        Text(store.lamps.on[index] ? "On" : "Off").foregroundStyle(.secondary)
                    }.padding(.vertical, 4)
                }
            }.font(.system(size: compact ? 17 : 20)).frame(minHeight: 48)
        }.padding(32).foregroundStyle(on ? .black : .white)
            .glassEffect(on ? .regular.tint(.orange.mix(with: .white, by: 0.90)) : .regular, in: .rect(cornerRadius: 40))
            .containerShape(.rect(cornerRadius: 40))
            .environment(\.colorScheme, on ? .light : .dark)
    }
}

struct LampBrightness: View {
    let store: any HomeDataSource
    var body: some View {
        GeometryReader { proxy in
            let enabled = store.lamps.anyOn
            ZStack(alignment: .bottom) {
                Color.primary.opacity(0.10)
                Rectangle().fill(.white)
                    .frame(height: proxy.size.height * Double(store.lamps.brightness) / 100)
                Image(systemName: "sun.max.fill").font(.system(size: min(44, proxy.size.width / 2), weight: .medium))
                    .foregroundStyle(store.lamps.brightness > 14 ? .black : .white)
                    .frame(maxWidth: .infinity).padding(.bottom, proxy.size.width <= 64 ? 16 : 34)
            }
            .clipShape(ConcentricRectangle())
            .containerShape(.rect(cornerRadius: 66))

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
    @State private var previewKelvin: Int?
    var body: some View {
        VStack(alignment: .leading, spacing: 28) {
            if let slot = editingSlot {
                LampColorEditor(slot: slot, initialHex: store.lamps.colors[slot],
                    cancel: { editingSlot = nil }, save: { hex in
                        store.send(.color(slot, hex)); editingSlot = nil
                    })
            } else {
                Picker("Lamp scene", selection: Binding(get: { store.lamps.scene == "White" ? "White" : "Mood" }, set: { store.send(.scene($0)) })) {
                    Text("White").tag("White")
                    Text("Colour").tag("Mood")
                }.pickerStyle(.segmented).controlSize(.extraLarge)
                if store.lamps.scene == "White" {
                    VStack(alignment: .leading, spacing: 18) {
                        HStack {
                            Text("White temperature").font(.title3.weight(.medium))
                            Spacer()
                            Text("\(previewKelvin ?? store.lamps.kelvin) K").font(.title2).monospacedDigit()
                        }
                        FilledLevelControl(value: store.lamps.kelvin, label: "White temperature", symbol: "thermometer.medium",
                            range: 2000...6500, step: 100, unit: "kelvin",
                            track: WhiteTemperaturePreview.gradient, fill: WhiteTemperaturePreview.color,
                            preview: { previewKelvin = $0 }) { store.send(.kelvin($0)) }
                            .frame(height: 100).accessibilityIdentifier("lamp-temperature")
                        HStack { Text("Warm · 2000 K"); Spacer(); Text("Daylight · 6500 K") }
                            .font(.callout).foregroundStyle(.secondary)
                    }.disabled(!store.lamps.anyOn).opacity(store.lamps.anyOn ? 1 : 0.4)
                } else {
                    HStack {
                        Text("Saved colours").font(.title3.weight(.medium))
                        Spacer()
                        Text("Tap to use").font(.callout).foregroundStyle(.secondary)
                    }
                    HStack(spacing: 20) {
                        ForEach(0..<3) { slot in
                            VStack(spacing: 12) {
                                Button { store.send(.color(slot, nil)) } label: {
                                    RoundedRectangle(cornerRadius: 24).fill(Color(hex: store.lamps.colors[slot]))
                                        .frame(height: 108)
                                        .overlay {
                                            if store.lamps.activeColor == slot {
                                                Image(systemName: "checkmark.circle.fill").font(.largeTitle)
                                                    .symbolRenderingMode(.palette).foregroundStyle(.black, .white)
                                            }
                                        }
                                }.buttonStyle(.plain).accessibilityLabel("Use Custom \(slot + 1)")
                                    .accessibilityValue(store.lamps.colors[slot])
                                    .accessibilityIdentifier("lamp-color-\(slot)")
                                    .accessibilityAddTraits(store.lamps.activeColor == slot ? .isSelected : [])
                                Button { editingSlot = slot } label: {
                                    Label("Customize", systemImage: "slider.horizontal.3").font(.callout.weight(.medium)).frame(minHeight: 44)
                                }.buttonStyle(.plain).accessibilityLabel("Edit Custom \(slot + 1)")
                            }.frame(maxWidth: .infinity)
                        }
                    }
                }
                Divider().overlay(.white.opacity(0.1))
                HStack {
                    Label("Party", systemImage: "sparkles").font(.title3.weight(.medium))
                    Spacer()
                    Menu {
                        ForEach(PartySpeed.allCases, id: \.self) { speed in
                            Button(speed.rawValue) { store.send(.party(speed)) }
                        }
                    } label: {
                        HStack { Text(store.lamps.party.rawValue); Image(systemName: "chevron.up.chevron.down").font(.caption) }
                            .padding(.horizontal, 20).frame(height: 52)
                    }.buttonStyle(.glass).disabled(!store.lamps.anyOn)
                }
            }
        }.frame(maxWidth: .infinity)
    }
}

private struct LampColorEditor: View {
    let slot: Int
    let cancel: () -> Void
    let save: (String) -> Void
    @State private var color: Color
    @Environment(\.self) private var environment
    init(slot: Int, initialHex: String, cancel: @escaping () -> Void, save: @escaping (String) -> Void) {
        self.slot = slot; self.cancel = cancel; self.save = save
        _color = State(initialValue: Color(hex: initialHex))
    }
    private let presets = ["#ff453a", "#ff9f0a", "#ffd60a", "#30d158", "#40c8e0", "#0a84ff", "#bf5af2", "#ff375f"]
    var body: some View {
        VStack(alignment: .leading, spacing: 24) {
            HStack {
                Text("Custom \(slot + 1)").font(.title2.weight(.semibold))
                Spacer()
                Button("Cancel", action: cancel).buttonStyle(.glass)
            }
            RoundedRectangle(cornerRadius: 28).fill(color.gradient).frame(height: 150)
                .accessibilityLabel("Colour preview")
            ColorPicker("Choose a colour", selection: $color, supportsOpacity: false)
                .font(.title3.weight(.medium)).padding(20)
                .background(.white.opacity(0.06), in: .rect(cornerRadius: 20))
                .accessibilityIdentifier("lamp-custom-color-picker")
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 44))], spacing: 12) {
                ForEach(presets, id: \.self) { hex in
                    Button { color = Color(hex: hex) } label: {
                        Circle().fill(Color(hex: hex)).frame(maxWidth: .infinity).frame(height: 44)
                    }.buttonStyle(.plain).accessibilityLabel("Colour \(hex)")
                }
            }
            Button {
                let resolved = color.resolve(in: environment)
                let hex = String(format: "#%02x%02x%02x", Int((min(1, max(0, resolved.red)) * 255).rounded()),
                    Int((min(1, max(0, resolved.green)) * 255).rounded()), Int((min(1, max(0, resolved.blue)) * 255).rounded()))
                save(hex)
            } label: {
                Label("Save & use", systemImage: "checkmark").font(.title3.weight(.semibold))
                    .frame(maxWidth: .infinity).padding(12)
            }.buttonStyle(.glassProminent).tint(.blue)
                .accessibilityIdentifier("lamp-save-color")
        }
    }
}
