import SwiftUI

/// A full-page thermostat: drag vertically, preview locally, commit on release.
struct ClimateController: View {
    let store: any HomeDataSource
    @State private var editingLow = false
    @Environment(\.horizontalSizeClass) private var sizeClass
    private var compact: Bool { sizeClass == .compact }
    private var climate: ClimateState { store.climate }
    private var target: Int { climate.mode == .heatCool ? (editingLow ? climate.low : climate.high) : climate.target }
    private var bounds: ClosedRange<Int> {
        guard climate.mode == .heatCool else { return 67...77 }
        return editingLow ? 67...max(67, climate.high - 2) : min(77, climate.low + 2)...77
    }
    private var color: Color { climate.mode == .heat || (climate.mode == .heatCool && editingLow) ? .orange : .cyan }
    var body: some View {
        VStack(spacing: 0) {
            if climate.mode == .off {
                VStack(spacing: 20) {
                    Image(systemName: "power").font(.system(size: 64, weight: .light)).foregroundStyle(.secondary)
                    Text("Off").font(.system(size: compact ? 100 : 180, weight: .regular, design: .rounded))
                        .accessibilityIdentifier("climate-value")
                    Text("Inside \(climate.ambient)°").font(.title2).foregroundStyle(.secondary)
                }.frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                VStack(spacing: 0) {
                    if climate.mode == .heatCool {
                        HStack(spacing: 16) {
                            rangeSelection(low: true)
                            rangeSelection(low: false)
                        }.padding(.horizontal, 32).padding(.top, 16)
                    }
                    ClimateTemperatureSurface(value: target, range: bounds, color: color,
                        title: climate.mode == .heatCool ? (editingLow ? "Heat to" : "Cool to") : "Set temperature",
                        subtitle: "Inside \(climate.ambient)° · \(climate.action)", commit: setTemperature)
                        .id("\(climate.mode.rawValue)-\(editingLow)")
                }
            }
            controls.padding(.horizontal, compact ? 20 : 64).padding(.top, 24).padding(.bottom, 36)
        }.background(Color(white: 0.055)).accessibilityIdentifier("climate-page")
    }
    private var controls: some View {
        GlassEffectContainer(spacing: 16) {
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 24) { modePicker; Spacer(minLength: 20); fanPicker }
                VStack(spacing: 20) { modePicker; fanPicker }
            }
        }
    }
    private var modePicker: some View {
        HStack(spacing: 10) {
            ForEach(ClimateMode.allCases, id: \.self) { mode in
                Button { store.send(.mode(mode)) } label: {
                    Label(mode.label, systemImage: mode == .cool ? "snowflake" : mode == .heat ? "sun.max.fill" : mode == .heatCool ? "arrow.up.arrow.down" : "power")
                        .font(.system(size: compact ? 16 : 20, weight: .medium)).padding(.horizontal, 14).frame(height: 56)
                }.buttonStyle(.plain)
                    .glassEffect(.regular.tint(climate.mode == mode ? .blue.opacity(0.45) : .clear).interactive(), in: .capsule)
                    .accessibilityIdentifier("mode-\(mode.rawValue)")
                    .accessibilityAddTraits(climate.mode == mode ? .isSelected : [])
            }
        }
    }
    private var fanPicker: some View {
        HStack(spacing: 16) {
            Image(systemName: "fan").font(.title2).accessibilityHidden(true)
            ForEach(climate.fanModes, id: \.self) { mode in
                Button(mode.capitalized) { store.send(.fanMode(mode)) }
                    .font(.system(size: 20, weight: .medium)).padding(.horizontal, 16).frame(height: 56)
                    .buttonStyle(.plain)
                    .glassEffect(.regular.tint(climate.selectedFanMode == mode ? .white.opacity(0.2) : .clear).interactive(), in: .capsule)
                    .accessibilityLabel("Fan \(mode)")
                    .accessibilityIdentifier("climate-fan-\(mode)")
                    .accessibilityAddTraits(climate.selectedFanMode == mode ? .isSelected : [])
            }
        }.accessibilityElement(children: .contain).accessibilityLabel("Fan")
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
    let range: ClosedRange<Int>
    let color: Color
    let title: String
    let subtitle: String
    let commit: (Int) -> Void
    @State private var draft: Int?
    @State private var dragStart: Int?
    private var displayed: Int { draft ?? value }
    private func bounded(_ value: Int) -> Int { min(range.upperBound, max(range.lowerBound, value)) }
    var body: some View {
        GeometryReader { proxy in
            let fraction = Double(displayed - 67) / 10
            ZStack(alignment: .bottom) {
                Rectangle().fill(color.opacity(0.08))
                Rectangle().fill(color.gradient.opacity(0.38))
                    .frame(height: proxy.size.height * fraction)
                Rectangle().fill(color.opacity(0.8)).frame(height: 2)
                    .offset(y: -proxy.size.height * fraction)
                VStack(spacing: 16) {
                    Text(title).font(.title2.weight(.medium)).foregroundStyle(.secondary)
                    HStack(spacing: 28) {
                        stepButton(delta: -1)
                        Text("\(displayed)°")
                            .font(.system(size: min(240, proxy.size.width * 0.25), weight: .regular, design: .rounded))
                            .monospacedDigit().minimumScaleFactor(0.6).lineLimit(1)
                            .accessibilityIdentifier("climate-value")
                        stepButton(delta: 1)
                    }
                    Text(subtitle).font(.title3).foregroundStyle(.secondary)
                    Label("Swipe up or down", systemImage: "arrow.up.arrow.down")
                        .font(.body).foregroundStyle(.secondary).padding(.top, 24)
                }.frame(maxWidth: .infinity, maxHeight: .infinity)
            }.contentShape(.rect)
                .gesture(DragGesture(minimumDistance: 10)
                    .onChanged { gesture in
                        if dragStart == nil { dragStart = value }
                        draft = bounded((dragStart ?? value) - Int((gesture.translation.height / max(1, proxy.size.height) * 10).rounded()))
                    }
                    .onEnded { _ in
                        if let draft { commit(draft) }
                        draft = nil; dragStart = nil
                    })
                .accessibilityElement(children: .contain)
                .accessibilityLabel(title).accessibilityValue("\(displayed) degrees Fahrenheit")
                .accessibilityAdjustableAction { direction in
                    if direction == .increment { commit(bounded(value + 1)) }
                    else if direction == .decrement { commit(bounded(value - 1)) }
                }
                .accessibilityIdentifier("climate-temperature-surface")
        }
    }
    private func stepButton(delta: Int) -> some View {
        Button { commit(bounded(value + delta)) } label: {
            Image(systemName: delta < 0 ? "minus" : "plus").font(.title2.weight(.medium))
                .frame(width: 64, height: 64)
        }.buttonStyle(.glass).buttonBorderShape(.circle)
            .disabled(delta < 0 ? displayed <= range.lowerBound : displayed >= range.upperBound)
            .accessibilityLabel(delta < 0 ? "Lower setpoint" : "Raise setpoint")
    }
}
