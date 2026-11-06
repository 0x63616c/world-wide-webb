import SwiftUI

/// A full-page thermostat: drag vertically, preview locally, commit on release.
struct ClimateController: View {
    let store: any HomeDataSource
    @State private var editingLow = false
    @State private var showingMore = false
    @Environment(\.horizontalSizeClass) private var sizeClass
    private var compact: Bool { sizeClass == .compact }
    private var climate: ClimateState { store.climate }
    private var target: Int { climate.mode == .heatCool ? (editingLow ? climate.low : climate.high) : climate.target }
    private var bounds: ClosedRange<Int> {
        guard climate.mode == .heatCool else { return 67...77 }
        return editingLow ? 67...max(67, climate.high - 2) : min(77, climate.low + 2)...77
    }
    var body: some View {
        VStack(spacing: 0) {
            if climate.mode == .off {
                VStack(spacing: 20) {
                    Image(systemName: "power").font(.system(size: 64, weight: .light)).foregroundStyle(.secondary)
                    Text("Off").font(.system(size: compact ? 100 : 180, weight: .regular, design: .rounded))
                        .accessibilityIdentifier("climate-value")
                }.frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                VStack(spacing: 0) {
                    if climate.mode == .heatCool {
                        HStack(spacing: 16) {
                            rangeSelection(low: true)
                            rangeSelection(low: false)
                        }.padding(.horizontal, 32).padding(.top, 16)
                    }
                    ClimateTemperatureSurface(value: target, midpoint: climate.ambient, range: bounds,
                        title: climate.mode == .heatCool ? (editingLow ? "Heat to" : "Cool to") : "Set temperature",
                        commit: setTemperature)
                        .id("\(climate.mode.rawValue)-\(editingLow)")
                }
            }
        }.background(Color(white: 0.055))
            .overlay(alignment: .bottomTrailing) { controls.padding(24) }
            .accessibilityIdentifier("climate-page")
    }
    private var controls: some View {
        HStack {
            Button {
                showingMore = true
            } label: {
                Image(systemName: "ellipsis")
                    .frame(width: 52, height: 52)
            }.buttonStyle(.glass).buttonBorderShape(.circle)
                .accessibilityLabel("More").accessibilityIdentifier("climate-more")
                .popover(isPresented: $showingMore, arrowEdge: .bottom) {
                    VStack(alignment: .leading, spacing: 12) {
                        Text("Climate mode").font(.headline)
                        ForEach(ClimateMode.allCases, id: \.self) { mode in
                            choice(mode.label, selected: climate.mode == mode, id: "mode-\(mode.rawValue)") {
                                store.send(.mode(mode))
                            }
                        }
                        Divider()
                        Text("Fan").font(.headline)
                        ForEach(climate.fanModes, id: \.self) { mode in
                            choice(mode.capitalized, selected: climate.selectedFanMode == mode, id: "climate-fan-\(mode)") {
                                store.send(.fanMode(mode))
                            }
                        }
                    }.padding(20).frame(minWidth: 240)
                        .presentationCompactAdaptation(.popover)
                }
        }.font(.title3.weight(.medium))
    }
    private func choice(_ title: String, selected: Bool, id: String, action: @escaping () -> Void) -> some View {
        Button {
            action()
            showingMore = false
        } label: {
            HStack {
                Text(title)
                Spacer()
                if selected { Image(systemName: "checkmark") }
            }.frame(minHeight: 44).contentShape(.rect)
        }.buttonStyle(.plain).accessibilityIdentifier(id)
            .accessibilityAddTraits(selected ? .isSelected : [])
    }

    private func rangeSelection(low: Bool) -> some View {
        Button { editingLow = low } label: {
            HStack(spacing: 12) {
                Image(systemName: low ? "sun.max.fill" : "snowflake").foregroundStyle(low ? .orange : .cyan)
                Text(low ? "Heat to" : "Cool to").foregroundStyle(.secondary)
                Text("\(low ? climate.low : climate.high)°").monospacedDigit()
            }.font(.title2.weight(.medium)).padding(.horizontal, 24).frame(height: 64)
                .background(editingLow == low ? .white.opacity(0.12) : .clear, in: .capsule)
        }.buttonStyle(.plain).accessibilityAddTraits(editingLow == low ? .isSelected : [])
            .accessibilityIdentifier(low ? "climate-range-low" : "climate-range-high")
    }
    private func setTemperature(_ value: Int) {
        if climate.mode == .heatCool { store.send(editingLow ? .low(value) : .high(value)) }
        else { store.send(.target(value)) }
    }
}

private struct ClimateTemperatureSurface: View {
    let value: Int
    let midpoint: Int
    let range: ClosedRange<Int>
    let title: String
    let commit: (Int) -> Void
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var dragFraction: Double?

    // Put the room temperature at the center while preserving the full setpoint range.
    private var center: Double { Double(min(76, max(68, midpoint))) }
    private func fraction(for value: Double) -> Double {
        value <= center ? 0.5 * (value - 67) / (center - 67)
            : 0.5 + 0.5 * (value - center) / (77 - center)
    }
    private func temperature(at fraction: Double) -> Double {
        fraction <= 0.5 ? 67 + fraction * 2 * (center - 67)
            : center + (fraction - 0.5) * 2 * (77 - center)
    }
    private func bounded(_ value: Int) -> Int { min(range.upperBound, max(range.lowerBound, value)) }
    private var position: Double { dragFraction ?? fraction(for: Double(value)) }
    private var displayed: Int { bounded(Int(temperature(at: position).rounded())) }

    var body: some View {
        GeometryReader { proxy in
            let height = proxy.size.height
            ZStack(alignment: .bottom) {
                Rectangle().fill(.yellow.opacity(0.08))
                Rectangle().fill(Color.yellow.gradient.opacity(0.38))
                    .frame(height: height * position)
                Rectangle().fill(.yellow.opacity(0.65)).frame(height: 1)
                    .offset(y: -height * position)
                Capsule().fill(.yellow)
                    .frame(width: 112, height: 7)
                    .offset(y: -min(max(0, height - 9), max(9, height * position - 3.5)))
                    .accessibilityHidden(true)
                Text("\(displayed)°")
                    .font(.system(size: min(310, proxy.size.width * 0.32), weight: .medium, design: .rounded))
                    .monospacedDigit().minimumScaleFactor(0.6).lineLimit(1)
                    .contentTransition(.numericText(value: Double(displayed)))
                    .animation(reduceMotion ? nil : .easeOut(duration: 0.16), value: displayed)
                    .shadow(color: .black.opacity(0.55), radius: 8)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .accessibilityIdentifier("climate-value")
            }.contentShape(.rect)
                .gesture(DragGesture(minimumDistance: 6)
                    .onChanged { gesture in
                        let start = fraction(for: Double(value))
                        let proposed = start - gesture.translation.height / max(1, height)
                        dragFraction = min(fraction(for: Double(range.upperBound)),
                            max(fraction(for: Double(range.lowerBound)), proposed))
                    }
                    .onEnded { _ in
                        let target = displayed
                        withAnimation(reduceMotion ? nil : .smooth(duration: 0.22)) {
                            if target != value { commit(target) }
                            dragFraction = nil
                        }
                    })
                .accessibilityElement(children: .contain)
                .accessibilityLabel(title).accessibilityValue("\(displayed) degrees Fahrenheit")
                .accessibilityAdjustableAction { direction in
                    withAnimation(reduceMotion ? nil : .smooth(duration: 0.22)) {
                        if direction == .increment { commit(bounded(value + 1)) }
                        else if direction == .decrement { commit(bounded(value - 1)) }
                    }
                }
                .accessibilityIdentifier("climate-temperature-surface")
        }
    }
}
