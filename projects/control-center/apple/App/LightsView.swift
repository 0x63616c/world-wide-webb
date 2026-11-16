import SwiftUI

/// What the lamps are showing, as far as the server reports it.
enum LampLook: Equatable {
    case white, mood
    case slot(Int)
}

/// Values under the user's finger, shown before a command is committed.
struct LampDraft: Equatable {
    var brightness: Int?
    var kelvin: Int?
    var hex: String?
}

extension LampState {
    static let moodColors = [
        "#9400d3", "#4b0082", "#005aff", "#ff0090", "#00c8b4", "#7828dc", "#00a0ff", "#dc00ff",
    ].map { Color(hex: $0) }

    var partyOn: Bool { party != .off || scene == "Party" }
    var look: LampLook? {
        if partyOn { return nil }
        if let activeColor, colors.indices.contains(activeColor) { return .slot(activeColor) }
        return scene == "White" ? .white : scene == "Mood" ? .mood : nil
    }
    /// Screen approximation of the light the lamps give off.
    func displayColors(_ draft: LampDraft = LampDraft()) -> [Color] {
        if partyOn { return Self.moodColors }
        switch look {
        case .white: return [WhiteTemperaturePreview.color(draft.kelvin ?? kelvin)]
        case .mood: return Self.moodColors
        case .slot(let slot): return [Color(hex: draft.hex ?? colors[slot])]
        case nil: return [WhiteTemperaturePreview.color(3000)]
        }
    }
    func lookName(_ draft: LampDraft = LampDraft()) -> String {
        if !anyOn { return "Off" }
        if partyOn { return party == .off ? "Party" : "Party · \(party.title)" }
        switch look {
        case .white:
            let kelvin = draft.kelvin ?? kelvin
            return "\(LampColor.temperatureName(kelvin)) · \(kelvin) K"
        case .mood: return "Mood"
        case .slot(let slot): return LampColor.name(hex: draft.hex ?? colors[slot])
        case nil: return "On"
        }
    }
}

extension PartySpeed {
    var title: String { self == .medium ? "Medium" : rawValue }
}

/// The Lights app: Home-style tiles for each group beside one panel for the lamps.
struct ControlsController: View {
    let store: any HomeDataSource
    var fanIsOn: Bool? = nil
    @State private var draft = LampDraft()
    var body: some View {
        GeometryReader { geometry in
            let narrow = geometry.size.width < 900
            ScrollView {
                (narrow
                    ? AnyLayout(VStackLayout(spacing: 24))
                    : AnyLayout(HStackLayout(alignment: .center, spacing: 32))) {
                        groups.frame(width: narrow ? nil : 440)
                        lampPanel(narrow: narrow)
                    }
                    .padding(narrow ? 20 : 40)
                    .frame(minHeight: geometry.size.height)
            }.scrollBounceBehavior(.basedOnSize).scrollIndicators(.hidden)
        }
        .background {
            ZStack {
                Color.black
                // The room picks up the colour of the lamps.
                RadialGradient(
                    colors: [(store.lamps.displayColors(draft).first ?? .clear).opacity(0.3), .clear],
                    center: UnitPoint(x: 0.68, y: 0.5), startRadius: 0, endRadius: 640
                )
                .opacity(store.lamps.anyOn ? Double(draft.brightness ?? store.lamps.brightness) / 100 : 0)
            }
            .animation(.smooth(duration: 0.4), value: store.lamps).ignoresSafeArea()
        }
    }

    private var groups: some View {
        let lamps = store.lamps
        let count = lamps.onCount() + (lamps.ceiling ? 1 : 0) + (lamps.cabinet ? 1 : 0)
        let total = LampState.names.count + 2
        return VStack(alignment: .leading, spacing: 20) {
            HStack(alignment: .center) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Lights").font(.system(size: 44, weight: .semibold))
                    Text(count == 0 ? "Everything is off" : "\(count) of \(total) on")
                        .font(.system(size: 20)).foregroundStyle(.white.opacity(0.6))
                        .contentTransition(.numericText()).animation(.smooth(duration: 0.25), value: count)
                }
                Spacer()
                // The server turns everything on unless every light is already on.
                Button {
                    store.send(.toggle(.all))
                } label: {
                    Label(count == total ? "All off" : "All on", systemImage: "power")
                        .font(.system(size: 19, weight: .semibold)).padding(.horizontal, 8).frame(height: 40)
                }.buttonStyle(.glass).accessibilityIdentifier("controller-toggle-all")
            }.padding(.bottom, 8)
            section("Lamps", detail: "Dimmer and colour on the right", keys: [.bedroom, .livingRoom])
            section("Fixed lights", detail: "On or off", keys: [.ceiling, .cabinet])
        }
    }

    private func section(_ title: String, detail: String, keys: [Accessory]) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(title).font(.system(size: 19, weight: .semibold))
                Text(detail).font(.system(size: 16)).foregroundStyle(.white.opacity(0.5))
            }
            HStack(spacing: 20) {
                ForEach(keys) { key in tile(key) }
            }
        }
    }

    private func tile(_ key: Accessory) -> some View {
        let lamps = store.lamps
        let on = lamps.isOn(key)
        let isLamp = !LampState.members(key).isEmpty
        // Lamp groups glow in the colour the lamps are showing; fixed lights are plain warm white.
        let colors = isLamp ? lamps.displayColors(draft) : [WhiteTemperaturePreview.color(3000)]
        let symbol =
            switch key {
            case .bedroom: "lamp.table"
            case .livingRoom: "lamp.floor"
            case .ceiling: "lamp.ceiling"
            default: "light.ribbon"
            }
        let status =
            !on ? "Off" : isLamp ? "\(draft.brightness ?? lamps.brightness)% · \(lamps.onCount(key)) lamps" : "On"
        return Button {
            store.send(.toggle(key))
        } label: {
            VStack(alignment: .leading, spacing: 4) {
                Image(systemName: symbol).symbolVariant(on ? .fill : .none).font(.system(size: 52))
                    .foregroundStyle(
                        on
                            ? AnyShapeStyle(
                                LinearGradient(
                                    colors: colors.map { $0.mix(with: .white, by: 0.45) }, startPoint: .top,
                                    endPoint: .bottom))
                            : AnyShapeStyle(.white.opacity(0.45))
                    )
                    .frame(width: 64, height: 64)
                    .background {
                        RadialGradient(
                            colors: [colors[0].opacity(0.55), .clear], center: .center, startRadius: 0, endRadius: 90
                        )
                        .frame(width: 180, height: 180).opacity(on ? 1 : 0)
                    }
                Spacer(minLength: 20)
                Text(key.name).font(.system(size: 22, weight: .semibold)).lineLimit(1).minimumScaleFactor(0.8)
                Text(status).font(.system(size: 17)).foregroundStyle(.white.opacity(on ? 0.75 : 0.5))
                    .monospacedDigit()
            }
            .padding(24).frame(maxWidth: .infinity, alignment: .leading).frame(height: 204)
            .contentShape(.rect)
        }
        .buttonStyle(LightTileStyle(on: on, colors: colors))
        .accessibilityLabel("Toggle \(key.name)").accessibilityValue(on ? "On" : "Off")
        .accessibilityIdentifier("controller-toggle-\(key.rawValue)")
    }

    private func lampPanel(narrow: Bool) -> some View {
        let lamps = store.lamps
        let dimmer = LampDimmer(
            value: lamps.brightness, on: lamps.anyOn, colors: lamps.displayColors(draft),
            preview: { draft.brightness = $0 }, commit: { store.send(.brightness($0)) },
            turnOn: { store.send(.toggle(.lamps)) }
        ).accessibilityIdentifier("lamp-brightness")
        return VStack(alignment: .leading, spacing: 28) {
            HStack(alignment: .center) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Lamps").font(.system(size: 28, weight: .semibold))
                    Text(lamps.lookName(draft)).font(.system(size: 19)).foregroundStyle(.white.opacity(0.6))
                }
                Spacer()
                Text(lamps.anyOn ? "\(draft.brightness ?? lamps.brightness)%" : "Off")
                    .font(.system(size: 56, weight: .medium, design: .rounded)).monospacedDigit()
                    .contentTransition(.numericText()).animation(.smooth(duration: 0.2), value: draft.brightness)
                    .accessibilityIdentifier("lamp-brightness-value")
            }
            if narrow {
                dimmer.frame(width: 120, height: 280).frame(maxWidth: .infinity)
                LampColorControls(store: store, draft: $draft, compact: true)
            } else {
                HStack(spacing: 32) {
                    dimmer.frame(width: 148)
                    LampColorControls(store: store, draft: $draft)
                }.fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(narrow ? 24 : 32)
        .glassEffect(.regular, in: .rect(cornerRadius: 44))
    }
}

/// One steady surface that eases between off and a wash of the light's colour: no material
/// swap and no colour-scheme flip, so a state change never flashes.
private struct LightTileStyle: ButtonStyle {
    let on: Bool
    let colors: [Color]
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .background {
                ZStack {
                    Color.white.opacity(0.07)
                    LinearGradient(colors: colors, startPoint: .topLeading, endPoint: .bottomTrailing)
                        .opacity(on ? 0.26 : 0)
                }
            }
            .clipShape(.rect(cornerRadius: 36))
            .overlay(RoundedRectangle(cornerRadius: 36).strokeBorder(.white.opacity(on ? 0.18 : 0.08)))
            .scaleEffect(configuration.isPressed ? 0.97 : 1)
            .animation(.smooth(duration: 0.3), value: on)
            .animation(.smooth(duration: 0.15), value: configuration.isPressed)
    }
}

/// Looks (white, mood and three saved colours), the picker for the chosen look, and party.
struct LampColorControls: View {
    let store: any HomeDataSource
    @Binding var draft: LampDraft
    var compact = false
    /// Keeps the picker in place while the server reports a mix it cannot name.
    @State private var lastLook = LampLook.white
    private static let whites = [("Candle", 2200), ("Warm", 2700), ("Neutral", 4000), ("Daylight", 6500)]
    var body: some View {
        let lamps = store.lamps
        VStack(alignment: .leading, spacing: 24) {
            HStack(alignment: .top, spacing: 0) {
                swatch(
                    .white, title: "White", symbol: "sun.max.fill",
                    fill: WhiteTemperaturePreview.color(draft.kelvin ?? lamps.kelvin))
                swatch(
                    .mood, title: "Mood", symbol: "sparkles",
                    fill: AngularGradient(colors: LampState.moodColors + [LampState.moodColors[0]], center: .center))
                ForEach(lamps.colors.indices, id: \.self) { slot in
                    let hex = lamps.look == .slot(slot) ? draft.hex ?? lamps.colors[slot] : lamps.colors[slot]
                    swatch(.slot(slot), title: LampColor.name(hex: hex), symbol: nil, fill: Color(hex: hex))
                }
            }
            editor.frame(height: compact ? 200 : 290)
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 10) {
                    partyLabel
                    Spacer(minLength: 16)
                    partySpeeds
                }
                VStack(alignment: .leading, spacing: 12) {
                    partyLabel
                    partySpeeds
                }
            }.disabled(!lamps.anyOn).opacity(lamps.anyOn ? 1 : 0.4)
        }
        .animation(.smooth(duration: 0.25), value: lamps.look).animation(.smooth(duration: 0.25), value: lamps.partyOn)
        .onChange(of: lamps.look, initial: true) { _, look in
            if let look { lastLook = look }
        }
    }

    private func swatch(_ look: LampLook, title: String, symbol: String?, fill: some ShapeStyle) -> some View {
        let selected = store.lamps.look == look
        let size: CGFloat = compact ? 44 : 64
        let identifier =
            switch look {
            case .white: "lamp-look-white"
            case .mood: "lamp-look-mood"
            case .slot(let slot): "lamp-look-color-\(slot)"
            }
        return Button {
            lastLook = look
            switch look {
            case .white: store.send(.scene("White"))
            case .mood: store.send(.scene("Mood"))
            case .slot(let slot): store.send(.color(slot, nil))
            }
        } label: {
            VStack(spacing: 8) {
                Circle().fill(fill).frame(width: size, height: size)
                    .overlay {
                        if let symbol {
                            Image(systemName: symbol).font(.system(size: size * 0.38, weight: .semibold))
                                .foregroundStyle(look == .white ? Color.black.opacity(0.55) : .white)
                        }
                    }
                    .padding(6)
                    .overlay(Circle().strokeBorder(.white.opacity(selected ? 1 : 0), lineWidth: 3))
                Text(title).font(.system(size: compact ? 13 : 16, weight: selected ? .semibold : .regular))
                    .foregroundStyle(.white.opacity(selected ? 1 : 0.6)).lineLimit(1)
            }.frame(maxWidth: .infinity).contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(symbol == nil ? "\(title) lamps, saved colour" : "\(title) lamps")
        .accessibilityAddTraits(selected ? .isSelected : [])
        .accessibilityIdentifier(identifier)
    }

    @ViewBuilder private var editor: some View {
        let lamps = store.lamps
        if lamps.partyOn {
            sceneCard("Party", detail: "The lamps cycle through colours. Choose a look to stop.")
        } else {
            switch lamps.look ?? lastLook {
            case .white:
                VStack(spacing: 16) {
                    TemperatureField(kelvin: lamps.kelvin, preview: { draft.kelvin = $0 }) { store.send(.kelvin($0)) }
                        .accessibilityIdentifier("lamp-temperature")
                    HStack(spacing: 10) {
                        ForEach(Self.whites, id: \.1) { name, kelvin in
                            Choice(title: name, selected: lamps.look == .white && lamps.kelvin == kelvin) {
                                store.send(.kelvin(kelvin))
                            }.frame(maxWidth: .infinity)
                        }
                    }
                }.disabled(!lamps.anyOn).opacity(lamps.anyOn ? 1 : 0.4)
            case .mood: sceneCard("Mood", detail: "Each lamp glows its own colour.")
            case .slot(let slot):
                ColorSpectrumField(hex: lamps.colors[slot], preview: { draft.hex = $0 }) {
                    store.send(.color(slot, $0))
                }.id(slot).accessibilityIdentifier("lamp-color-picker")
            }
        }
    }

    private func sceneCard(_ title: String, detail: String) -> some View {
        LinearGradient(colors: LampState.moodColors, startPoint: .topLeading, endPoint: .bottomTrailing)
            .overlay(alignment: .bottomLeading) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(title).font(.system(size: 24, weight: .semibold))
                    Text(detail).font(.system(size: 17)).opacity(0.85)
                }.padding(24).shadow(color: .black.opacity(0.4), radius: 6)
            }
            .clipShape(.rect(cornerRadius: 28))
    }

    private var partyLabel: some View {
        Label("Party", systemImage: "party.popper.fill").font(.system(size: 19, weight: .semibold))
    }
    private var partySpeeds: some View {
        HStack(spacing: 8) {
            ForEach(PartySpeed.allCases, id: \.self) { speed in
                Choice(title: speed.title, selected: store.lamps.party == speed) { store.send(.party(speed)) }
            }
        }
    }
}

#Preview("Lights", traits: .fixedLayout(width: 1366, height: 952)) {
    ControlsController(store: MockHomeDataSource()).foregroundStyle(.white).environment(\.colorScheme, .dark)
}
