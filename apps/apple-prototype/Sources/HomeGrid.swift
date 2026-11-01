import SwiftUI
#if canImport(UIKit)
import UIKit
private typealias GridFont = UIFont
#else
import AppKit
private typealias GridFont = NSFont
#endif

/// WWW-54 base grid for the iPad landscape Home face (spec: docs/v2/home-grid.md).
/// Six columns by four rows of square 192 pt cells, 24 pt gutters, and a 24 pt
/// inset inside every card so text sits the same distance from each edge.
enum HomeGrid {
    static let columns = 6, rows = 4
    static let cell: CGFloat = 192, gutter: CGFloat = 24, inset: CGFloat = 24, radius: CGFloat = 40
    static let top: CGFloat = 32, heading: CGFloat = 40, headingGap: CGFloat = 16
    static let args = ProcessInfo.processInfo.arguments
    static func option(_ key: String) -> String? {
        guard let i = args.firstIndex(of: key), args.indices.contains(i + 1) else { return nil }
        return args[i + 1]
    }
    /// The grid is the shipped Home (WWW-54). `-legacyHome` keeps the old 5×3 faces for comparison.
    static var enabled: Bool { !args.contains("-legacyHome") }
    static var overlay: Bool { args.contains("-gridOverlay") }
    static var sheet: GridCard? { option("-gridSheet") == "clockwide" ? .clock : option("-gridSheet").flatMap(GridCard.init(rawValue:)) }
    /// `-gridSheet clockwide` shows only the wide clock variants (E–H).
    static var sheetLetters: [String]? { option("-gridSheet") == "clockwide" ? ["E", "F", "G", "H"] : nil }
    static var width: CGFloat { CGFloat(columns) * cell + CGFloat(columns - 1) * gutter }
    static var height: CGFloat { CGFloat(rows) * cell + CGFloat(rows - 1) * gutter }
    static func span(_ w: Int, _ h: Int) -> CGSize {
        CGSize(width: CGFloat(w) * cell + CGFloat(w - 1) * gutter, height: CGFloat(h) * cell + CGFloat(h - 1) * gutter)
    }
    static func origin(in size: CGSize) -> CGPoint {
        CGPoint(x: floor((size.width - width) / 2), y: top + heading + headingGap)
    }
    static func frame(_ p: GridPlacement, in size: CGSize) -> CGRect {
        let o = origin(in: size), s = span(p.variant.w, p.variant.h)
        return CGRect(x: o.x + CGFloat(p.x) * (cell + gutter), y: o.y + CGFloat(p.y) * (cell + gutter), width: s.width, height: s.height)
    }
    /// Home is one continuous layout split over pages: page 1 fills all 24 cells, and only the
    /// overflow goes to page 2, packed from the top-left with no holes.
    /// Page 1: four 2×1 glances down the left (clock H, car, lamps, fan), then two 2×2 columns.
    static let home: [GridPlacement] = [
        .init(.clock, "H", 0, 0), .init(.climate, "A", 2, 0), .init(.lights, "D", 4, 0),
        .init(.car, "A", 0, 1),
        .init(.lamps, "A", 0, 2), .init(.weather, "C", 2, 2), .init(.calendar, "B", 4, 2),
        .init(.fan, "C", 0, 3)
    ]
    /// Page 2: ordinary grid cards, packed to 24/24 cells like page 1.
    static let more: [GridPlacement] = [
        .init(.nowPlaying, "B", 0, 0), .init(.cameras, "A", 2, 0), .init(.photos, "A", 4, 0),
        .init(.sonosRooms, "A", 0, 2), .init(.dogwalk, "A", 2, 2), .init(.media, "A", 4, 2),
        .init(.wifi, "A", 0, 3)
    ]
    static func placements(page: Int) -> [GridPlacement] { page == 0 ? home : more }
}

enum GridCard: String, CaseIterable {
    case climate, lamps, weather, car, calendar, nowPlaying = "nowplaying", fan, lights, clock
    case cameras, photos, sonosRooms, wifi, dogwalk, media
    var title: String {
        switch self {
        case .climate: "Climate"; case .lamps: "Lamps"; case .weather: "Weather"; case .car: "Car"
        case .cameras: "Cameras"; case .photos: "Photos"; case .sonosRooms: "Sonos rooms"
        case .wifi: "Wi-Fi"; case .dogwalk: "Walk Zero"; case .media: "Media"
        case .calendar: "Up next"; case .nowPlaying: "Now Playing"; case .fan: "Fan"; case .lights: "Lights"; case .clock: "Clock"
        }
    }
    var variants: [GridVariant] {
        switch self {
        case .cameras: [.init("A", 2, 2, "Full-bleed feed + caption"), .init("B", 2, 1, "Wide feed + caption")]
        case .photos: [.init("A", 2, 2, "Full-bleed rotating photo"), .init("B", 2, 1, "Wide rotating photo")]
        case .sonosRooms: [.init("A", 2, 1, "Playing rooms + room count"), .init("B", 2, 2, "Room playback + volumes")]
        case .wifi: [.init("A", 2, 1, "Guest network + join"), .init("B", 2, 2, "Guest network + join QR")]
        case .dogwalk: [.init("A", 2, 2, "Walk status + weekly total"), .init("B", 2, 1, "Walk status + start/end")]
        case .media: [.init("A", 2, 2, "Library artwork + title"), .init("B", 2, 1, "Library glance")]
        case .climate: [.init("A", 2, 2, "Hero: inside temp, stepper below"), .init("B", 2, 1, "Wide: inside left, setpoint right"),
                        .init("C", 1, 2, "Tall: inside temp over stepper"), .init("D", 1, 1, "Glance: inside + setpoint, tap to adjust")]
        case .lamps: [.init("A", 2, 1, "Count + brightness bar"), .init("B", 2, 2, "Room toggles + brightness"),
                      .init("C", 1, 1, "Glance: brightness + count"), .init("D", 1, 2, "Whole tile is the dimmer")]
        case .weather: [.init("A", 2, 1, "Corners: city, icon, temp, high/low"), .init("B", 1, 1, "Glance: city + temp"),
                        .init("C", 2, 2, "Now + next 5 hours"), .init("D", 2, 1, "Hourly strip")]
        case .car: [.init("A", 2, 1, "Charge first, kW badge"), .init("B", 1, 1, "Glance: charge + bar"),
                    .init("C", 2, 1, "Range first"), .init("D", 1, 2, "Tall battery fill")]
        case .calendar: [.init("A", 2, 1, "Next event"), .init("B", 2, 2, "Today's agenda"),
                         .init("C", 1, 1, "Glance: time + title"), .init("D", 2, 1, "Date block + next event")]
        case .nowPlaying: [.init("A", 2, 1, "Artwork + track"), .init("B", 2, 2, "Full-bleed artwork"),
                           .init("C", 1, 1, "Artwork tile"), .init("D", 2, 1, "Track + transport")]
        case .fan: [.init("A", 1, 1, "Square: corners"), .init("B", 1, 1, "Round (current)"),
                    .init("C", 2, 1, "Off / Auto / On segments"), .init("D", 1, 2, "Tall segments")]
        case .lights: [.init("A", 1, 1, "Square toggle", .cabinet), .init("B", 1, 1, "Round toggle (current)", .ceiling),
                       .init("C", 2, 1, "Ceiling + cabinet pair"), .init("D", 2, 2, "All lights list")]
        case .clock: [.init("A", 1, 1, "Green analog"), .init("B", 2, 2, "Large green analog"),
                      .init("C", 1, 2, "Analog over digital"), .init("D", 2, 1, "Analog + date"),
                      .init("E", 2, 1, "Wide: bold time only"), .init("F", 2, 2, "Big: bold time, day underneath"),
                      .init("G", 2, 2, "Stacked hours over minutes"), .init("H", 2, 1, "Wide: bold time, day in corner")]
        }
    }
    func variant(_ letter: String) -> GridVariant { variants.first { $0.letter == letter } ?? variants[0] }
}
struct GridVariant {
    let letter: String, w: Int, h: Int, name: String
    var accessory: Accessory?
    init(_ letter: String, _ w: Int, _ h: Int, _ name: String, _ accessory: Accessory? = nil) {
        self.letter = letter; self.w = w; self.h = h; self.name = name; self.accessory = accessory
    }
}
struct GridPlacement: Identifiable {
    let card: GridCard, variant: GridVariant, x: Int, y: Int
    var accessory: Accessory?
    var id: String { "\(card.rawValue)-\(variant.letter)-\(accessory?.rawValue ?? "")-\(x)-\(y)" }
    init(_ card: GridCard, _ letter: String, _ x: Int, _ y: Int, _ accessory: Accessory? = nil) {
        self.card = card; variant = card.variant(letter); self.x = x; self.y = y
        self.accessory = accessory ?? variant.accessory
    }
}

/// Text trimmed to cap height on top and baseline at the bottom, so an inset is
/// measured to the ink rather than to the font's line box.
struct Cap: View {
    let text: String
    var size: CGFloat
    var weight: Font.Weight = .regular
    var design: Font.Design = .default
    var lines = 1
    init(_ text: String, _ size: CGFloat, _ weight: Font.Weight = .regular, design: Font.Design = .default, lines: Int = 1) {
        self.text = text; self.size = size; self.weight = weight; self.design = design; self.lines = lines
    }
    var body: some View {
        let f = GridFont.systemFont(ofSize: size)
        Text(text).font(.system(size: size, weight: weight, design: design)).monospacedDigit()
            .lineLimit(lines).fixedSize(horizontal: false, vertical: true)
            .padding(.top, -(f.ascender - f.capHeight)).padding(.bottom, f.descender)
    }
}

private let warm = Color.orange
private let coolBlue = Color(red: 0.42, green: 0.70, blue: 1.0)

struct GridMaterial: ViewModifier {
    let on: Bool
    var round = false
    var image = false
    func body(content: Content) -> some View {
        let glass = image ? Glass.clear : on ? Glass.regular.tint(.orange.mix(with: .white, by: 0.90).opacity(0.65)) : Glass.regular.tint(.white.opacity(0.05))
        Group {
            if round { content.glassEffect(glass.interactive(), in: .circle) }
            else {
                content.glassEffect(glass.interactive(), in: .rect(cornerRadius: HomeGrid.radius))
                    .containerShape(.rect(cornerRadius: HomeGrid.radius))
            }
        }.environment(\.colorScheme, on ? .light : .dark)
    }
}

struct GridCardView: View {
    let card: GridCard
    let variant: GridVariant
    var accessory: Accessory?
    let store: any HomeDataSource
    var open: () -> Void = {}
    private var size: CGSize { HomeGrid.span(variant.w, variant.h) }
    private var v: String { variant.letter }
    private var on: Bool {
        switch card {
        case .lamps: store.lamps.anyOn
        case .lights:
            if v == "A" || v == "B", let a = accessory { store.lamps.isOn(a) } else { false }
        default: false
        }
    }
    private var round: Bool { (card == .fan || card == .lights) && v == "B" }
    private var image: Bool { card == .cameras || card == .photos || card == .weather || card == .clock || (card == .nowPlaying && (v == "B" || v == "C")) }
    var body: some View {
        content
            .frame(width: size.width, height: size.height)
            .modifier(GridCardInteraction(label: "Open \(card.title)", open: open))
            .foregroundStyle(on ? .black : .white)
            .modifier(GridMaterial(on: on, round: round, image: image))
    }
    @ViewBuilder private var content: some View {
        switch card {
        case .climate: GridClimate(v: v, store: store)
        case .lamps: GridLamps(v: v, store: store, size: size)
        case .weather: GridWeather(v: v, store: store)
        case .car: GridCar(v: v, store: store, size: size)
        case .calendar: GridCalendar(v: v, store: store)
        case .nowPlaying: GridNowPlaying(v: v, store: store)
        case .fan: GridFan(v: v, store: store)
        case .lights: GridLights(v: v, accessory: accessory ?? .ceiling, store: store)
        case .clock: GridClock(v: v, store: store)
        case .cameras: GridCameras(store: store)
        case .photos: GridPhotos(store: store)
        case .sonosRooms: GridSonosRooms(v: v, store: store)
        case .wifi: GridWifi(v: v, store: store)
        case .dogwalk: GridDogWalk(v: v, store: store, open: open)
        case .media: GridMedia(v: v, store: store)
        }
    }
}

/// A sibling behind the content owns disclosure; controls never inherit a card gesture.
struct GridCardInteraction: ViewModifier {
    let label: String
    let open: () -> Void
    func body(content: Content) -> some View {
        content.background {
            Button(action: open) {
                Color.clear.contentShape(.rect)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(label)
        }
    }
}

// MARK: - Shared pieces

/// Four-corner arrangement inside the even inset.
struct Corners<TL: View, TR: View, BL: View, BR: View>: View {
    @ViewBuilder var tl: TL
    @ViewBuilder var tr: TR
    @ViewBuilder var bl: BL
    @ViewBuilder var br: BR
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .top, spacing: 12) { tl; Spacer(minLength: 0); tr }
            Spacer(minLength: 0)
            HStack(alignment: .bottom, spacing: 12) { bl; Spacer(minLength: 0); br }
        }.padding(HomeGrid.inset).frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
private func roundButton(_ symbol: String, _ d: CGFloat, action: @escaping () -> Void) -> some View {
    Button(action: action) {
        Image(systemName: symbol).font(.system(size: d * 0.4, weight: .semibold))
            .frame(width: d, height: d).background(.white.opacity(0.16), in: .circle).contentShape(.circle)
    }.buttonStyle(.plain)
        .accessibilityLabel(symbol == "plus" ? "Increase temperature" : "Decrease temperature")
        .accessibilityIdentifier("grid-climate-\(symbol)")
}
private struct Bar: View {
    let fraction: Double
    var color: Color = warm
    var height: CGFloat = 10
    /// Charging: a soft highlight sweeps left to right across the fill while it gently
    /// brightens and dims (1.8 s loop). Static with Reduce Motion or when not charging.
    var charging = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.motionPhase) private var fixedPhase
    var body: some View {
        GeometryReader { g in
            let w = max(height, g.size.width * fraction)
            ZStack(alignment: .leading) {
                Capsule().fill(.primary.opacity(0.18))
                if charging && !reduceMotion {
                    TimelineView(.animation(paused: fixedPhase != nil)) { ctx in
                        let phase = fixedPhase ?? ChargingShimmer.phase(ctx.date)
                        let glow = ChargingShimmer.glow(phase)
                        let band = w * 0.35
                        Capsule().fill(color).brightness(0.10 * glow)
                            .overlay(alignment: .leading) {
                                LinearGradient(colors: [.white.opacity(0), .white.opacity(0.4), .white.opacity(0)], startPoint: .leading, endPoint: .trailing)
                                    .frame(width: band).offset(x: -band + (w + band) * phase)
                                    .blendMode(.plusLighter)
                            }
                            .clipShape(.capsule)
                            .frame(width: w)
                    }
                } else {
                    Capsule().fill(color).frame(width: w)
                }
            }
        }.frame(height: height)
    }
}
/// The charging sweep + brightness pulse, shared by the Car A bar and kW badge. Phase comes
/// from the wall clock, so every charging element sweeps in step (1.8 s loop).
struct ChargingShimmer: ViewModifier {
    static let period = 1.8
    static func phase(_ date: Date) -> Double { date.timeIntervalSinceReferenceDate.truncatingRemainder(dividingBy: period) / period }
    static func glow(_ phase: Double) -> Double { 0.5 - 0.5 * cos(phase * 2 * .pi) }
    let active: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.motionPhase) private var fixedPhase
    func body(content: Content) -> some View {
        if active && !reduceMotion {
            TimelineView(.animation(paused: fixedPhase != nil)) { ctx in
                let phase = fixedPhase ?? Self.phase(ctx.date)
                content.brightness(0.10 * Self.glow(phase))
                    .overlay {
                        GeometryReader { g in
                            let band = g.size.width * 0.6
                            LinearGradient(colors: [.white.opacity(0), .white.opacity(0.28), .white.opacity(0)], startPoint: .leading, endPoint: .trailing)
                                .frame(width: band).offset(x: -band + (g.size.width + band) * phase)
                                .blendMode(.plusLighter)
                        }.clipShape(.capsule).allowsHitTesting(false)
                    }
            }
        } else {
            content
        }
    }
}
private struct Toggle2: View {
    let on: Bool
    var body: some View {
        Capsule().fill(on ? AnyShapeStyle(warm) : AnyShapeStyle(.primary.opacity(0.2)))
            .frame(width: 52, height: 32)
            .overlay(alignment: on ? .trailing : .leading) { Circle().fill(.white).padding(3) }
    }
}
private struct Segments: View {
    let items: [String]
    let selected: String
    var vertical = false
    let select: (String) -> Void
    var body: some View {
        let layout = vertical ? AnyLayout(VStackLayout(spacing: 6)) : AnyLayout(HStackLayout(spacing: 6))
        layout {
            ForEach(items, id: \.self) { item in
                Button { select(item) } label: {
                    Text(item).font(.system(size: 17, weight: .semibold))
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .contentShape(.rect)
                        .background(item == selected ? AnyShapeStyle(.white.opacity(0.28)) : AnyShapeStyle(.clear), in: .rect(cornerRadius: 12))
                }.buttonStyle(.plain)
                    .accessibilityLabel("Fan \(item)")
                    .accessibilityValue(item == selected ? "Selected" : "")
                    .accessibilityIdentifier("fan-mode-\(item.lowercased())")
            }
        }.padding(6).background(.white.opacity(0.1), in: .rect(cornerRadius: 16))
    }
}

// MARK: - Climate

private struct GridClimate: View {
    let v: String
    let store: any HomeDataSource
    private var c: ClimateState { store.climate }
    private var setpoint: String { c.mode == .off ? "Off" : c.mode == .heatCool ? "\(c.low)–\(c.high)°" : "\(c.target)°" }
    private var statusIcon: String { c.mode == .heat ? "flame.fill" : c.mode == .off ? "power" : "snowflake" }
    private func step(_ delta: Int) { store.send(c.mode == .heatCool ? .shiftRange(delta) : .target(c.target + delta)) }
    var body: some View {
        switch v {
        case "A":
            VStack(alignment: .leading, spacing: 0) {
                HStack(alignment: .top) {
                    Cap("Climate", 22, .semibold); Spacer()
                    Label { Cap(c.action, 20, .medium) } icon: { Image(systemName: statusIcon).font(.system(size: 18)) }
                        .foregroundStyle(coolBlue)
                }
                Spacer(minLength: 0)
                Cap("Inside", 20).opacity(0.65)
                Cap("\(c.ambient)°", 128, .light).padding(.top, 20)
                Spacer(minLength: 0)
                HStack {
                    roundButton("minus", 56) { step(-1) }
                    Spacer()
                    VStack(spacing: 10) { Cap("Set to", 17).opacity(0.65); Cap(setpoint, 34, .semibold).foregroundStyle(coolBlue) }
                    Spacer()
                    roundButton("plus", 56) { step(1) }
                }
            }.padding(HomeGrid.inset)
        case "B":
            HStack(spacing: 0) {
                VStack(alignment: .leading, spacing: 0) {
                    Cap("Climate", 22, .semibold)
                    Spacer(minLength: 0)
                    HStack(alignment: .bottom, spacing: 10) { Cap("\(c.ambient)°", 80, .light); Cap("inside", 17).opacity(0.65) }
                }
                Spacer(minLength: 0)
                VStack(alignment: .trailing, spacing: 0) {
                    Cap("\(c.action) to", 17).opacity(0.65)
                    Spacer(minLength: 0)
                    HStack(spacing: 12) {
                        roundButton("minus", 48) { step(-1) }
                        Cap(setpoint, 30, .semibold).foregroundStyle(coolBlue)
                        roundButton("plus", 48) { step(1) }
                    }
                }
            }.padding(HomeGrid.inset)
        case "C":
            VStack(alignment: .leading, spacing: 0) {
                Cap("Climate", 20, .semibold)
                Cap(c.action, 17).foregroundStyle(coolBlue).padding(.top, 12)
                Spacer(minLength: 0)
                Cap("Inside", 17).opacity(0.65)
                Cap("\(c.ambient)°", 72, .light).padding(.top, 14)
                Spacer(minLength: 0)
                VStack(spacing: 12) {
                    Cap("Set to \(setpoint)", 20, .semibold).foregroundStyle(coolBlue)
                    HStack { roundButton("minus", 56) { step(-1) }; Spacer(); roundButton("plus", 56) { step(1) } }
                }
            }.padding(HomeGrid.inset)
        default:
            Corners {
                VStack(alignment: .leading, spacing: 10) {
                    Cap("Inside", 17, .semibold)
                    Cap("Set \(setpoint)", 17, .semibold).foregroundStyle(coolBlue)
                }
            } tr: {
                Image(systemName: statusIcon).font(.system(size: 18)).foregroundStyle(coolBlue)
            } bl: {
                Cap("\(c.ambient)°", 64, .light).fixedSize()
            } br: { EmptyView() }
        }
    }
}

// MARK: - Lamps

private struct GridLamps: View {
    let v: String
    let store: any HomeDataSource
    let size: CGSize
    private var l: LampState { store.lamps }
    private var pct: Double { Double(l.brightness) / 100 }
    private var brightnessSlider: some View {
        Slider(value: Binding(get: { Double(l.brightness) }, set: { store.send(.brightness(Int($0.rounded()))) }), in: 0...100)
            .tint(warm).disabled(!l.anyOn)
            .accessibilityLabel("Lamp brightness").accessibilityIdentifier("grid-lamp-brightness")
    }

    var body: some View {
        switch v {
        case "A":
            VStack(alignment: .leading, spacing: 0) {
                HStack(alignment: .top) { Cap("Lamps", 22, .semibold); Spacer(); Cap("\(l.onCount()) of 8 on", 17).opacity(0.65) }
                Spacer(minLength: 0)
                Cap("\(l.brightness)%", 48, .medium, design: .rounded)
                brightnessSlider.padding(.top, 16)
            }.padding(HomeGrid.inset)
        case "B":
            VStack(alignment: .leading, spacing: 0) {
                HStack(alignment: .top) { Cap("Lamps", 22, .semibold); Spacer(); Cap("\(l.brightness)%", 22, .semibold, design: .rounded) }
                Color.clear.frame(height: 40)
                VStack(spacing: 28) {
                    ForEach([Accessory.bedroom, .livingRoom], id: \.self) { key in
                        HStack {
                            VStack(alignment: .leading, spacing: 10) {
                                Cap(key.name, 20, .semibold)
                                Cap(l.onCount(key) > 0 ? "\(l.onCount(key)) on" : "Off", 15).opacity(0.6)
                            }
                            Spacer()
                            Button { store.send(.toggle(key)) } label: { Toggle2(on: l.onCount(key) > 0) }.buttonStyle(.plain)
                        }
                    }
                }
                Spacer(minLength: 0)
                brightnessSlider
            }.padding(HomeGrid.inset)
        case "C":
            Corners {
                Cap("Lamps", 17, .semibold)
            } tr: {
                Cap("\(l.onCount())/8", 17).opacity(0.6)
            } bl: {
                Cap("\(l.brightness)%", 48, .medium, design: .rounded)
            } br: { EmptyView() }
        default:
            ZStack(alignment: .bottom) {
                Rectangle().fill(warm.opacity(0.75)).frame(height: size.height * pct)
                VStack(alignment: .leading, spacing: 0) {
                    Cap("Lamps", 20, .semibold)
                    Cap("\(l.onCount()) of 8 on", 17).opacity(0.65).padding(.top, 12)
                    Spacer(minLength: 0)
                    Cap("\(l.brightness)%", 48, .medium, design: .rounded)
                    brightnessSlider.padding(.top, 12)
                }.padding(HomeGrid.inset).frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
            }.frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottom)
                .clipShape(.rect(cornerRadius: HomeGrid.radius))
        }
    }
}

// MARK: - Weather

private struct GridWeather: View {
    let v: String
    let store: any HomeDataSource
    private var w: WeatherState { store.weather }
    private func icon(_ size: CGFloat, _ name: String? = nil) -> some View {
        Image(systemName: name ?? w.symbol).symbolRenderingMode(.multicolor).font(.system(size: size))
    }
    private func hours(_ n: Int) -> some View {
        HStack(alignment: .bottom, spacing: 0) {
            ForEach(Array(w.hours.prefix(n).enumerated()), id: \.offset) { i, h in
                VStack(spacing: 12) {
                    Cap(i == 0 ? "Now" : h.time, 15, .medium).opacity(0.75)
                    icon(22, h.symbol).frame(height: 24)
                    Cap("\(h.temperature)°", 20, .medium)
                }
                if i < n - 1 { Spacer(minLength: 0) }
            }
        }
    }
    var body: some View {
        ZStack {
            WeatherSky(condition: w.condition).saturation(0.75).brightness(-0.08).padding(-32)
            Group {
                switch v {
                case "A":
                    Corners {
                        Cap(w.city, 20, .medium)
                    } tr: { icon(34) } bl: {
                        Cap("\(w.temperature)°", 80, .light)
                    } br: {
                        VStack(alignment: .trailing, spacing: 12) { Cap(w.condition, 17, .medium); Cap("H:\(w.high)°  L:\(w.low)°", 17) }
                    }
                case "B":
                    Corners {
                        Cap(w.city, 15, .medium)
                    } tr: { EmptyView() } bl: {
                        VStack(alignment: .leading, spacing: 14) { icon(28); Cap("\(w.temperature)°", 60, .light) }
                    } br: { EmptyView() }
                case "C":
                    VStack(alignment: .leading, spacing: 0) {
                        HStack(alignment: .top) {
                            VStack(alignment: .leading, spacing: 12) { Cap(w.city, 22, .medium); Cap(w.condition, 17).opacity(0.8) }
                            Spacer(); icon(40)
                        }
                        Spacer(minLength: 0)
                        HStack(alignment: .bottom) {
                            Cap("\(w.temperature)°", 104, .light); Spacer()
                            Cap("H:\(w.high)°  L:\(w.low)°", 17)
                        }
                        Spacer(minLength: 0)
                        hours(5)
                    }.padding(HomeGrid.inset)
                default:
                    VStack(alignment: .leading, spacing: 0) {
                        HStack(alignment: .top) {
                            Cap("\(w.city)  \(w.temperature)°", 20, .medium); Spacer()
                            Cap("H:\(w.high)°  L:\(w.low)°", 17)
                        }
                        Spacer(minLength: 0)
                        hours(6)
                    }.padding(HomeGrid.inset)
                }
            }
        }.clipShape(.rect(cornerRadius: HomeGrid.radius))
    }
}

// MARK: - Car

private struct GridCar: View {
    let v: String
    let store: any HomeDataSource
    let size: CGSize
    private var t: TeslaData { store.tesla.data }
    private var green: Color { .green }
    private var badge: some View {
        Label { Cap("\(t.rate.formatted()) kW", 15, .semibold) } icon: { Image(systemName: "bolt.fill").font(.system(size: 13)) }
            .foregroundStyle(green).padding(.horizontal, 12).padding(.vertical, 9).background(green.opacity(0.18), in: .capsule)
            .modifier(ChargingShimmer(active: t.charging))
    }
    var body: some View {
        switch v {
        case "A":
            VStack(alignment: .leading, spacing: 0) {
                HStack(alignment: .top) {
                    HStack(alignment: .center, spacing: 8) {
                        Cap(t.name, 22, .semibold)
                        // Locked state: subtle, hidden when unlocked.
                        if t.locked { Image(systemName: "lock.fill").font(.system(size: 15, weight: .semibold)).opacity(0.5) }
                    }
                    Spacer(); if t.charging { badge.padding(.top, -9) }
                }
                Spacer(minLength: 0)
                HStack(alignment: .bottom, spacing: 12) {
                    Cap("\(t.pct)%", 56, .medium, design: .rounded)
                    Spacer()
                    // Range now / full-charge range, bottom-right corner.
                    Cap(t.maxRange > 0 ? "\(t.range)/\(t.maxRange) mi" : "\(t.range) mi", 20).opacity(0.7)
                }
                Bar(fraction: Double(t.pct) / 100, color: green, height: 8, charging: t.charging).padding(.top, 16)
            }.padding(HomeGrid.inset)
        case "B":
            VStack(alignment: .leading, spacing: 0) {
                HStack(alignment: .top) { Cap(t.name, 17, .semibold); Spacer(); if t.charging { Image(systemName: "bolt.fill").foregroundStyle(green) } }
                Spacer(minLength: 0)
                Cap("\(t.pct)%", 48, .medium, design: .rounded)
                Cap("\(t.range) mi", 15).opacity(0.7).padding(.top, 12)
                Bar(fraction: Double(t.pct) / 100, color: green, height: 8).padding(.top, 14)
            }.padding(HomeGrid.inset)
        case "C":
            Corners {
                Cap("\(t.name) · \(t.place)", 20, .semibold)
            } tr: {
                Cap("\(t.pct)%", 20, .semibold, design: .rounded).foregroundStyle(green)
            } bl: {
                HStack(alignment: .bottom, spacing: 8) { Cap("\(t.range)", 80, .light); Cap("mi", 22).opacity(0.7) }
            } br: {
                if t.charging { badge }
            }
        default:
            ZStack(alignment: .bottom) {
                Rectangle().fill(green.opacity(0.32)).frame(height: size.height * Double(t.pct) / 100)
                VStack(alignment: .leading, spacing: 0) {
                    Cap(t.name, 20, .semibold)
                    if t.charging { Cap("Charging", 17).foregroundStyle(green).padding(.top, 12) }
                    Spacer(minLength: 0)
                    Cap("\(t.pct)%", 48, .medium, design: .rounded)
                    Cap("\(t.range) mi", 17).opacity(0.7).padding(.top, 12)
                }.padding(HomeGrid.inset).frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
            }.frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottom)
                .clipShape(.rect(cornerRadius: HomeGrid.radius))
        }
    }
}

// MARK: - Calendar

private struct GridCalendar: View {
    let v: String
    let store: any HomeDataSource
    private var day: String { store.calendar.dateText(at: store.now, format: "EEE").uppercased() }
    private var date: String { store.calendar.dateText(at: store.now, format: "d") }
    private var next: AgendaEvent? { store.calendar.next(at: store.now) }
    var body: some View {
        switch v {
        case "A":
            Corners {
                HStack(spacing: 8) { Cap(day, 17, .semibold).foregroundStyle(.red); Cap(date, 17, .semibold) }
            } tr: { Cap("Up next", 17).opacity(0.65) } bl: {
                VStack(alignment: .leading, spacing: 14) {
                    Cap(next?.title ?? "Nothing else today", 28, .semibold)
                    if let e = next { Cap("\(e.time) \(e.period) · \(e.location)", 17).opacity(0.7) }
                }
            } br: { EmptyView() }
        case "B":
            VStack(alignment: .leading, spacing: 0) {
                HStack(alignment: .top) {
                    Cap("Today", 22, .semibold); Spacer()
                    HStack(spacing: 8) { Cap(day, 17, .semibold).foregroundStyle(.red); Cap(date, 17, .semibold) }
                }
                Color.clear.frame(height: 36)
                VStack(alignment: .leading, spacing: 26) {
                    ForEach(store.calendar.events) { e in
                        let isNext = e.id == next?.id
                        let past = next.map { e.minutes < $0.minutes } ?? true
                        HStack(alignment: .top, spacing: 14) {
                            Capsule().fill(isNext ? Color.red : .white.opacity(0.3)).frame(width: 4, height: 38).padding(.top, -2)
                            VStack(alignment: .leading, spacing: 10) {
                                Cap(e.title, 20, .semibold)
                                Cap("\(e.time) \(e.period) · \(e.location)", 15).opacity(0.65)
                            }
                        }.opacity(past ? 0.45 : 1)
                    }
                }
                Spacer(minLength: 0)
            }.padding(HomeGrid.inset)
        case "C":
            Corners {
                Cap(next.map { "\($0.time) \($0.period)" } ?? day, 17, .semibold).foregroundStyle(.red)
            } tr: { EmptyView() } bl: {
                Cap(next?.title ?? "Free", 22, .semibold, lines: 2)
            } br: { EmptyView() }
        default:
            HStack(spacing: 0) {
                VStack(alignment: .leading, spacing: 0) {
                    Cap(day, 17, .semibold).foregroundStyle(.red)
                    Spacer(minLength: 0)
                    Cap(date, 80, .light)
                }.frame(width: 96, alignment: .leading)
                Rectangle().fill(.white.opacity(0.2)).frame(width: 1).padding(.trailing, 24)
                VStack(alignment: .leading, spacing: 0) {
                    Cap("UP NEXT", 13, .semibold).opacity(0.65)
                    Spacer(minLength: 0)
                    Cap(next?.title ?? "Nothing else today", 24, .semibold)
                    if let e = next {
                        Cap("\(e.time) \(e.period)", 17).padding(.top, 14)
                        Cap(e.location, 15).opacity(0.65).padding(.top, 10)
                    }
                }
                Spacer(minLength: 0)
            }.padding(HomeGrid.inset)
        }
    }
}

// MARK: - Now Playing

private struct GridNowPlaying: View {
    let v: String
    let store: any HomeDataSource
    var body: some View {
        if let room = store.rooms.first {
            content(room)
        } else {
            Corners { Cap("Sonos", 20, .semibold) } tr: { EmptyView() } bl: { Cap("Nothing playing", 17) } br: { EmptyView() }
        }
    }
    private func art(_ room: SoundRoom) -> some View { FixtureArtwork(tint: room.artworkTint) }
    private func roomLine(_ room: SoundRoom) -> some View {
        HStack(spacing: 8) {
            PlayingEqualizer(playing: room.playing).scaleEffect(0.6).frame(width: 20, height: 14)
            Cap(room.name, 15).opacity(0.75)
        }
    }
    @ViewBuilder private func content(_ room: SoundRoom) -> some View {
        let title = room.trackTitle ?? "Nothing playing", artist = room.trackArtist ?? "Sonos"
        switch v {
        case "A":
            HStack(spacing: 24) {
                art(room).frame(width: 144, height: 144).clipShape(.rect(cornerRadius: HomeGrid.radius - HomeGrid.inset))
                VStack(alignment: .leading, spacing: 0) {
                    Cap(title, 22, .semibold, lines: 2)
                    Cap(artist, 17).opacity(0.7).padding(.top, 12)
                    Spacer(minLength: 0)
                    roomLine(room)
                }
                Spacer(minLength: 0)
            }.padding(HomeGrid.inset)
        case "B":
            ZStack {
                art(room)
                LinearGradient(colors: [.black.opacity(0.35), .clear, .black.opacity(0.75)], startPoint: .top, endPoint: .bottom)
                Corners { EmptyView() } tr: { EmptyView() } bl: {
                    VStack(alignment: .leading, spacing: 14) { roomLine(room).opacity(0.85).padding(.bottom, 4); Cap(title, 28, .semibold); Cap(artist, 20).opacity(0.8) }
                } br: {
                    Image(systemName: room.playing ? "pause.fill" : "play.fill").font(.system(size: 22))
                        .frame(width: 56, height: 56).background(.white.opacity(0.22), in: .circle)
                }
            }.clipShape(.rect(cornerRadius: HomeGrid.radius))
        case "C":
            ZStack {
                art(room)
                LinearGradient(colors: [.clear, .black.opacity(0.7)], startPoint: .center, endPoint: .bottom)
                Corners { EmptyView() } tr: { EmptyView() } bl: { Cap(title, 17, .semibold, lines: 2) } br: { EmptyView() }
            }.clipShape(.rect(cornerRadius: HomeGrid.radius))
        default:
            VStack(alignment: .leading, spacing: 0) {
                HStack(alignment: .top, spacing: 16) {
                    VStack(alignment: .leading, spacing: 12) { Cap(title, 22, .semibold); Cap(artist, 17).opacity(0.7) }
                    Spacer(minLength: 0)
                    art(room).frame(width: 56, height: 56).clipShape(.rect(cornerRadius: 12))
                }
                Spacer(minLength: 0)
                HStack(alignment: .center, spacing: 28) {
                    Image(systemName: "backward.fill"); Image(systemName: room.playing ? "pause.fill" : "play.fill").font(.system(size: 30)); Image(systemName: "forward.fill")
                    Spacer()
                    Cap("\(room.name) · \(room.displayVolume)%", 15).opacity(0.7)
                }.font(.system(size: 24))
            }.padding(HomeGrid.inset)
        }
    }
}

// MARK: - Fan

struct GridFan: View {
    let v: String
    let store: any HomeDataSource
    var fanIsOn: Bool? = nil
    var fanLabel: String? = nil
    var showsInlineToggle = false
    private var on: Bool { fanIsOn ?? (store.climate.fanOn && store.climate.mode != .off) }
    private var label: String { fanLabel ?? store.climate.fanLabel }
    // Web parity: Off releases forced circulation (fan_mode=auto); HVAC may
    // still run its blower. The reported label distinguishes Auto from HVAC Off.
    private func select(_ value: String) { store.send(.fan(value == "On")) }
    /// The glyph toggles the fan in place; the rest of the card opens the controller.
    private func toggle(_ size: CGFloat) -> some View {
        Button { store.send(.toggle(.fan)) } label: {
            FanSymbol(on: on).font(.system(size: size)).frame(minWidth: 44, minHeight: 44, alignment: .topTrailing)
        }.buttonStyle(.plain).padding(-10)
            .accessibilityLabel("Toggle Fan").accessibilityValue(on ? "On" : "Off").accessibilityIdentifier("toggle-fan")
    }
    var body: some View {
        switch v {
        case "A":
            Corners {
                Cap("Fan", 17, .semibold)
            } tr: {
                if showsInlineToggle { toggle(26) }
                else { FanSymbol(on: on).font(.system(size: 26)) }
            } bl: { Cap(label, 28, .medium) } br: { EmptyView() }
        case "B":
            VStack(spacing: 14) {
                FanSymbol(on: on).font(.system(size: 44))
                Cap("Fan", 20, .semibold)
                Cap(label, 17).opacity(0.7)
            }.frame(maxWidth: .infinity, maxHeight: .infinity)
        case "C":
            VStack(alignment: .leading, spacing: 0) {
                HStack(alignment: .top) { Cap("Fan", 22, .semibold); Spacer(); toggle(26) }
                Spacer(minLength: 0)
                Segments(items: ["Off", "Auto", "On"], selected: label, select: select).frame(height: 60)
            }.padding(HomeGrid.inset)
        default:
            VStack(alignment: .leading, spacing: 0) {
                HStack(alignment: .top) { Cap("Fan", 20, .semibold); Spacer(); toggle(24) }
                Spacer(minLength: 0)
                Segments(items: ["On", "Auto", "Off"], selected: label, vertical: true, select: select).frame(height: 228)
            }.padding(HomeGrid.inset)
        }
    }
}

// MARK: - Lights

private struct GridLights: View {
    let v: String
    let accessory: Accessory
    let store: any HomeDataSource
    private var l: LampState { store.lamps }
    private func name(_ a: Accessory) -> String { a == .all ? "All lights" : a == .cabinet ? "Cabinet" : a.name }
    private func symbol(_ a: Accessory) -> String { a == .all ? "lightbulb.2.fill" : a.symbol }
    private func state(_ a: Accessory) -> String {
        if a == .all { return l.isOn(.all) ? "All on" : (l.anyOn || l.ceiling || l.cabinet) ? "Some on" : "All off" }
        return l.isOn(a) ? "On" : "Off"
    }
    private func lit(_ a: Accessory) -> Bool { a == .all ? (l.anyOn || l.ceiling || l.cabinet) : l.isOn(a) }
    var body: some View {
        switch v {
        case "A":
            Button { store.send(.toggle(accessory)) } label: {
                Corners {
                    Image(systemName: symbol(accessory)).font(.system(size: 28)).symbolRenderingMode(.hierarchical)
                        .foregroundStyle(lit(accessory) ? AnyShapeStyle(warm) : AnyShapeStyle(.primary))
                } tr: { EmptyView() } bl: {
                    VStack(alignment: .leading, spacing: 10) { Cap(name(accessory), 20, .semibold); Cap(state(accessory), 15).opacity(0.65) }
                } br: { EmptyView() }
            }.buttonStyle(.plain)
        case "B":
            VStack(spacing: 14) {
                Image(systemName: symbol(accessory)).font(.system(size: 40)).symbolRenderingMode(.hierarchical)
                    .foregroundStyle(lit(accessory) ? AnyShapeStyle(warm) : AnyShapeStyle(.primary))
                Cap(name(accessory), 20, .semibold)
                Cap(state(accessory), 17).opacity(0.7)
            }.frame(maxWidth: .infinity, maxHeight: .infinity)
        case "C":
            VStack(alignment: .leading, spacing: 0) {
                HStack(alignment: .top) { Cap("Lights", 22, .semibold); Spacer(); Cap("\([l.ceiling, l.cabinet].count { $0 }) of 2 on", 17).opacity(0.65) }
                Spacer(minLength: 0)
                HStack(spacing: 12) {
                    ForEach([Accessory.ceiling, .cabinet], id: \.self) { a in
                        Button { store.send(.toggle(a)) } label: {
                            HStack(spacing: 10) {
                                Image(systemName: symbol(a)).font(.system(size: 18))
                                Cap(name(a), 17, .semibold)
                            }.frame(maxWidth: .infinity).frame(height: 60)
                                .foregroundStyle(l.isOn(a) ? .black : .white)
                                .background(l.isOn(a) ? AnyShapeStyle(warm.mix(with: .white, by: 0.35)) : AnyShapeStyle(.white.opacity(0.12)), in: .rect(cornerRadius: 16))
                        }.buttonStyle(.plain)
                    }
                }
            }.padding(HomeGrid.inset)
        default:
            VStack(alignment: .leading, spacing: 0) {
                HStack(alignment: .top) { Cap("Lights", 22, .semibold); Spacer(); Cap(state(.all), 17).opacity(0.65) }
                Color.clear.frame(height: 40)
                VStack(spacing: 24) {
                    ForEach([Accessory.ceiling, .cabinet, .lamps], id: \.self) { a in
                        HStack {
                            VStack(alignment: .leading, spacing: 10) {
                                Cap(a == .lamps ? "Lamps" : name(a), 20, .semibold)
                                Cap(a == .lamps ? "\(l.onCount()) of 8 on" : state(a), 15).opacity(0.6)
                            }
                            Spacer()
                            Button { store.send(.toggle(a)) } label: { Toggle2(on: l.isOn(a)) }.buttonStyle(.plain)
                                .accessibilityLabel("Toggle \(a == .lamps ? "Lamps" : name(a))").accessibilityValue(l.isOn(a) ? "On" : "Off")
                                .accessibilityIdentifier("toggle-\(a.rawValue)")
                        }
                    }
                }
                Spacer(minLength: 0)
                Cap("Tap a row to adjust", 15).opacity(0.5)
            }.padding(HomeGrid.inset)
        }
    }
}

// MARK: - Clock (green)

struct GridClock: View {
    let v: String
    let store: any HomeDataSource
    private var face: some View { AnalogClock(date: store.now, minimal: true).aspectRatio(1, contentMode: .fit) }
    /// Big bold numerals that grow until they meet the inset on the tighter axis.
    private func bold(_ text: String) -> some View {
        Text(text).font(.system(size: 400, weight: .bold, design: .rounded)).monospacedDigit().tracking(-4)
            .lineLimit(1).minimumScaleFactor(0.05)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
    var body: some View {
        ZStack {
            Palette.clock
            switch v {
            case "E":
                bold(fixtureTime(store.now, format: "h:mm")).padding(HomeGrid.inset)
            case "F":
                VStack(alignment: .leading, spacing: 0) {
                    Spacer(minLength: 0)
                    bold(fixtureTime(store.now, format: "h:mm"))
                    Spacer(minLength: 0)
                    Cap(fixtureTime(store.now, format: "EEEE"), 22, .semibold).opacity(0.85)
                }.padding(HomeGrid.inset)
            case "G":
                VStack(spacing: -24) {
                    bold(fixtureTime(store.now, format: "h"))
                    bold(fixtureTime(store.now, format: "mm"))
                }.padding(HomeGrid.inset)
            case "H":
                VStack(alignment: .leading, spacing: 0) {
                    Cap(fixtureTime(store.now, format: "EEE d MMM"), 17, .semibold).opacity(0.85)
                    Spacer(minLength: 0)
                    bold(fixtureTime(store.now, format: "h:mm"))
                }.padding(HomeGrid.inset)
            case "A", "B":
                face.padding(HomeGrid.inset)
            case "C":
                VStack(alignment: .leading, spacing: 0) {
                    face
                    Spacer(minLength: 0)
                    Cap(fixtureTime(store.now, format: "h:mm"), 48, .light)
                    Cap(fixtureTime(store.now, format: "EEEE"), 17).opacity(0.8).padding(.top, 12)
                }.padding(HomeGrid.inset)
            default:
                HStack(spacing: 24) {
                    face
                    VStack(alignment: .leading, spacing: 0) {
                        Cap(fixtureTime(store.now, format: "EEE d MMM"), 17, .semibold).opacity(0.85)
                        Spacer(minLength: 0)
                        Cap(fixtureTime(store.now, format: "h:mm"), 56, .light)
                    }
                    Spacer(minLength: 0)
                }.padding(HomeGrid.inset)
            }
        }.clipShape(.rect(cornerRadius: HomeGrid.radius))
    }
}

// MARK: - Faces

struct GridHomeFace: View {
    let store: any HomeDataSource
    let size: CGSize
    var page = 0
    let open: (HomeTile) -> Void
    var zoom: Namespace.ID? = nil
    @Namespace private var standaloneZoom
    @Environment(\.homeIntegration) private var integration
    @State private var picker = HomeGrid.args.contains("-showWallpaperPicker")
    var body: some View {
        let o = HomeGrid.origin(in: size)
        ZStack(alignment: .topLeading) {
            HStack(alignment: .center) {
                Text("Home").font(.system(size: 36, weight: .bold)).foregroundStyle(.white)
                    .onLongPressGesture { picker = true }
                Spacer()  // no date here: Clock H already shows it
            }.frame(width: HomeGrid.width, height: HomeGrid.heading)
                .position(x: o.x + HomeGrid.width / 2, y: HomeGrid.top + HomeGrid.heading / 2)
            ForEach(HomeGrid.placements(page: page)) { p in
                let f = HomeGrid.frame(p, in: size), t = tile(p)
                Group {
                    // A host with no live data for this module shows its own unavailable tile.
                    if let integration, t != .clock, !integration.available(t), let replacement = integration.tile(t, open: { open(t) }) {
                        replacement.padding(HomeGrid.inset).frame(width: f.width, height: f.height).modifier(GridMaterial(on: false))
                    } else if let replacement = integration?.gridTile(t, span: f.size, open: { open(t) }) {
                        replacement.frame(width: f.width, height: f.height)
                            .clipShape(.rect(cornerRadius: HomeGrid.radius))
                            .modifier(GridMaterial(on: false))
                    } else {
                        GridCardView(card: p.card, variant: p.variant, accessory: p.accessory, store: store, open: { open(t) })
                    }
                }.accessibilityElement(children: .contain).accessibilityIdentifier("tile-\(t.id)")
                    .matchedTransitionSource(id: "\(page + 1)-\(t.id)", in: zoom ?? standaloneZoom)
                    .position(x: f.midX, y: f.midY)
            }
        }.frame(width: size.width, height: size.height)
            .overlay { if HomeGrid.overlay { GridOverlay(size: size).allowsHitTesting(false) } }
            .sheet(isPresented: $picker) { WallpaperPicker() }
    }
    private func tile(_ p: GridPlacement) -> HomeTile {
        switch p.card {
        case .climate: .climate; case .lamps: .lamps; case .weather: .weather; case .car: .tesla
        case .calendar: .calendar; case .nowPlaying: .sound; case .fan: .fan; case .clock: .clock
        case .cameras: .cameras; case .photos: .photos; case .sonosRooms: .sonosRooms
        case .wifi: .wifi; case .dogwalk: .dogwalk; case .media: .media
        case .lights: p.accessory == .cabinet ? .cabinet : p.accessory == .all ? .all : .ceiling
        }
    }
}

struct GridOverlay: View {
    let size: CGSize
    private let pink = Color(red: 1, green: 0.2, blue: 0.6)
    private let cyan = Color(red: 0.2, green: 0.95, blue: 1)
    var body: some View {
        let o = HomeGrid.origin(in: size), c = HomeGrid.cell, g = HomeGrid.gutter, i = HomeGrid.inset
        ZStack(alignment: .topLeading) {
            ForEach(0..<HomeGrid.rows, id: \.self) { r in
                ForEach(0..<HomeGrid.columns, id: \.self) { col in
                    let x = o.x + CGFloat(col) * (c + g), y = o.y + CGFloat(r) * (c + g)
                    Rectangle().fill(pink.opacity(0.10)).overlay(Rectangle().stroke(pink.opacity(0.9), lineWidth: 1.5))
                        .frame(width: c, height: c).position(x: x + c / 2, y: y + c / 2)
                    Rectangle().stroke(cyan.opacity(0.9), style: StrokeStyle(lineWidth: 1, dash: [6, 4]))
                        .frame(width: c - 2 * i, height: c - 2 * i).position(x: x + c / 2, y: y + c / 2)
                    Text("\(col + 1),\(r + 1)").font(.system(size: 12, weight: .bold, design: .monospaced)).foregroundStyle(pink)
                        .padding(4).background(.black.opacity(0.6), in: .rect(cornerRadius: 4))
                        .position(x: x + c - 24, y: y + c - 14)
                }
            }
            tag("192 × 192 cell").position(x: o.x + c / 2, y: o.y + c + g / 2)
            tag("24 gutter").position(x: o.x + c + g / 2, y: o.y + c / 2 - 40).rotationEffect(.zero)
            tag("24 inset", color: cyan).position(x: o.x + c / 2, y: o.y + i / 2)
            tag("margin \(Int(o.x))").position(x: o.x / 2 + 4, y: o.y + c * 1.5).rotationEffect(.degrees(-90))
            Text("6 × 4 grid · cell 192 pt · gutter 24 pt · card inset 24 pt · corner radius 40 pt · spans 1×1, 2×1, 1×2, 2×2")
                .font(.system(size: 17, weight: .semibold)).foregroundStyle(.white)
                .padding(.horizontal, 14).padding(.vertical, 8).background(.black.opacity(0.7), in: .capsule)
                .position(x: size.width / 2, y: o.y + HomeGrid.height + 26)
        }.frame(width: size.width, height: size.height)
    }
    private func tag(_ s: String, color: Color? = nil) -> some View {
        Text(s).font(.system(size: 13, weight: .bold)).foregroundStyle(color ?? pink).fixedSize()
            .padding(.horizontal, 6).padding(.vertical, 3).background(.black.opacity(0.75), in: .capsule)
    }
}

struct GridSheetPage: View {
    let card: GridCard
    let store: any HomeDataSource
    var letters: [String]? = nil
    private var variants: [GridVariant] { card.variants.filter { letters?.contains($0.letter) ?? true } }
    var body: some View {
        let rows = packed()
        ZStack {
            Wallpaper()
            VStack(alignment: .leading, spacing: 0) {
                HStack(alignment: .firstTextBaseline, spacing: 16) {
                    Text(card.title).font(.system(size: 36, weight: .bold))
                    Text("\(variants.count) variations · 6×4 grid · 192 pt cell · 24 pt gutter and inset").font(.system(size: 18, weight: .medium)).opacity(0.75)
                }
                Spacer(minLength: 0)
                VStack(alignment: .leading, spacing: 36) {
                    ForEach(rows.indices, id: \.self) { r in
                        HStack(alignment: .top, spacing: 32) {
                            ForEach(rows[r], id: \.letter) { variant in
                                VStack(alignment: .leading, spacing: 14) {
                                    VStack(alignment: .leading, spacing: 4) {
                                        Text("\(card.title) \(variant.letter) · \(variant.w)×\(variant.h)").font(.system(size: 18, weight: .bold))
                                        Text(variant.name).font(.system(size: 14, weight: .medium)).opacity(0.8).lineLimit(1).minimumScaleFactor(0.7)
                                    }.frame(width: HomeGrid.span(variant.w, variant.h).width, alignment: .leading)
                                    GridCardView(card: card, variant: variant, accessory: variant.accessory, store: store)
                                }
                            }
                        }
                    }
                }.frame(maxWidth: .infinity)
                Spacer(minLength: 0)
            }.padding(.horizontal, 40).padding(.top, 32).padding(.bottom, 40)
        }.foregroundStyle(.white).environment(\.colorScheme, .dark)
    }
    private func packed() -> [[GridVariant]] {
        var rows: [[GridVariant]] = [[]], width: CGFloat = 0
        for variant in variants {
            let w = HomeGrid.span(variant.w, variant.h).width
            if !rows[rows.count - 1].isEmpty && width + 32 + w > 1296 { rows.append([]); width = 0 }
            width += (rows[rows.count - 1].isEmpty ? 0 : 32) + w
            rows[rows.count - 1].append(variant)
        }
        return rows
    }
}

// MARK: - Wallpaper setting

enum WallpaperChoice: String, CaseIterable, Identifiable {
    // WWW-54: plain black is the default; photos threw the layout review off.
    case black, lake, coast, forest, cloud, graphite, dusk
    static let key = "wallpaper"
    var id: String { rawValue }
    var title: String {
        switch self {
        case .black: "Black"; case .lake: "Lake"; case .coast: "Coast"; case .forest: "Forest"; case .cloud: "Sky"; case .graphite: "Graphite"; case .dusk: "Dusk"
        }
    }
    var asset: String? {
        switch self {
        case .lake: "LakeWallpaper"; case .coast: "CoastPhoto"; case .forest: "ForestPhoto"; case .cloud: "CloudPhoto"
        default: nil
        }
    }
    @ViewBuilder var fill: some View {
        switch self {
        case .black: Color.black
        case .graphite: Color(white: 0.16)
        case .dusk: LinearGradient(colors: [Color(hex: "#1b2a4a"), Color(hex: "#6b3a6e"), Color(hex: "#d9774f")], startPoint: .topLeading, endPoint: .bottomTrailing)
        default: Image(asset ?? "LakeWallpaper").resizable().scaledToFill()
        }
    }
}

struct WallpaperPicker: View {
    @AppStorage(WallpaperChoice.key) private var choice: WallpaperChoice = .black
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        NavigationStack {
            ScrollView {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 200), spacing: 24)], spacing: 24) {
                    ForEach(WallpaperChoice.allCases) { item in
                        Button { choice = item } label: {
                            VStack(spacing: 10) {
                                item.fill.frame(height: 150).clipShape(.rect(cornerRadius: 20))
                                    .overlay(RoundedRectangle(cornerRadius: 20).stroke(item == choice ? Color.white : .clear, lineWidth: 4))
                                Text(item.title).font(.system(size: 17, weight: item == choice ? .bold : .medium))
                            }
                        }.buttonStyle(.plain).accessibilityAddTraits(item == choice ? .isSelected : [])
                    }
                }.padding(24)
            }.navigationTitle("Wallpaper")
                .toolbar { Button("Done") { dismiss() } }
        }
    }
}
