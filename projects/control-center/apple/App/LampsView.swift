import SwiftUI

struct LampsController: View {
    let store: any HomeDataSource
    @State private var showingEffects = false
    @Environment(\.horizontalSizeClass) private var sizeClass
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
                    Button {
                        showingEffects = true
                    } label: {
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
                            CircleButton(symbol: "xmark", label: "Close Color & Effects", size: 48) {
                                showingEffects = false
                            }
                        }
                        Text("All lamps").foregroundStyle(.secondary)
                        LampColorControls(store: store, draft: .constant(LampDraft()), compact: compact)
                    }.padding(24).frame(maxWidth: 600)
                }.presentationSizing(.fitted).preferredColorScheme(.dark)
            }
    }
    private var brightnessHeading: some View {
        VStack(spacing: 4) {
            Text("Global brightness").font(.system(size: compact ? 22 : 28, weight: .semibold))
            Text("\(store.lamps.brightness)%")
                .font(.system(size: compact ? 72 : 96, weight: .medium, design: .rounded)).monospacedDigit()
                .contentTransition(.numericText()).accessibilityIdentifier("lamp-brightness-value")
                .animation(.smooth(duration: 0.25), value: store.lamps.brightness)
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
                Toggle(
                    "Power",
                    isOn: Binding(
                        get: { store.lamps.isOn(key) },
                        set: { requested in
                            if store.lamps.isOn(key) != requested { store.send(.toggle(key)) }
                        })
                )
                .labelsHidden().toggleStyle(.switch).tint(.orange)
                .accessibilityLabel("\(key.name) power")
                .accessibilityIdentifier("controller-toggle-\(key.rawValue)")
            }.frame(minHeight: 64)
            HStack(spacing: 8) {
                Image(systemName: key.symbol).symbolRenderingMode(.hierarchical)
                    .font(.system(size: 28)).foregroundStyle(on ? .orange : .secondary)
                Text(
                    on
                        ? "On · \(store.lamps.onCount(key)) of \(LampState.members(key).count) lamps"
                        : "Off · \(LampState.members(key).count) lamps"
                )
                .font(.system(size: 20)).foregroundStyle(.primary)
            }
            DisclosureGroup("Show lamps") {
                ForEach(Array(LampState.members(key)), id: \.self) { index in
                    HStack {
                        Text(LampState.names[index])
                        Spacer()
                        Text(store.lamps.on[index] ? "On" : "Off").foregroundStyle(.secondary)
                    }.padding(.vertical, 4)
                }
            }.font(.system(size: compact ? 17 : 20)).frame(minHeight: 48)
        }.padding(32).foregroundStyle(on ? .black : .white)
            .glassEffect(
                on ? .regular.tint(.orange.mix(with: .white, by: 0.90)) : .regular, in: .rect(cornerRadius: 40)
            )
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
            .gesture(
                DragGesture(minimumDistance: 0).onChanged { value in
                    guard enabled else { return }
                    store.send(.brightness(Int((100 * (1 - value.location.y / proxy.size.height)).rounded())))
                }
            )
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
