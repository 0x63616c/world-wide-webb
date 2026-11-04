import AirMilesCore
import SwiftUI

struct OverviewView: View {
    @Environment(FlightStore.self) private var store
    @State private var detail: Flight?
    @State private var tabletop = false
    var showFlights: () -> Void

    var body: some View {
        GeometryReader { geometry in
            if tabletop && geometry.size.width > 550 {
                VStack(spacing: 0) {
                    atlasHero(compact: true).frame(height: geometry.size.height * 0.47)
                    ScrollView {
                        HStack(alignment: .top, spacing: 20) {
                            VStack(alignment: .leading, spacing: 12) {
                                Eyebrow("Your flight board")
                                Text("A lifetime of takeoffs.").font(.title2.bold())
                                metricStrip
                            }.frame(maxWidth: .infinity)
                            recentFlights(limit: 2).frame(maxWidth: .infinity)
                        }.padding(24)
                    }.background(AMStyle.paper)
                }
            } else {
                ScrollView {
                    VStack(alignment: .leading, spacing: 24) {
                        HStack(alignment: .bottom) {
                            VStack(alignment: .leading, spacing: 6) {
                                Eyebrow(store.isDemo ? "Sample journal" : "Your flight journal")
                                Text("A world of memories.").font(.system(size: 31, weight: .bold, design: .rounded)).tracking(-1)
                            }
                            Spacer(minLength: 4)
                            Text(yearRange).font(.system(size: 11, weight: .medium, design: .monospaced)).foregroundStyle(.secondary)
                        }
                        atlasHero(compact: geometry.size.width < 500)
                            .frame(height: geometry.size.width < 500 ? 310 : 340)
                            .clipShape(RoundedRectangle(cornerRadius: 26))
                        metricStrip
                        if geometry.size.width > 700 {
                            HStack(alignment: .top, spacing: 20) {
                                recentFlights(limit: 3).frame(maxWidth: .infinity)
                                milestone.frame(maxWidth: .infinity)
                            }
                        } else {
                            recentFlights(limit: 3)
                            milestone
                        }
                        Text("Every route has a story.").font(.footnote).foregroundStyle(.tertiary).frame(maxWidth: .infinity).padding(.vertical, 6)
                    }.padding(geometry.size.width > 600 ? 28 : 20).frame(maxWidth: 1150).frame(maxWidth: .infinity)
                }.background(AMStyle.paper)
            }
        }
        .navigationBarTitleDisplayMode(.inline)
        .modifier(HingeObserver(tabletop: $tabletop))
        .sheet(item: $detail) { flight in
            NavigationStack { FlightDetailView(flight: flight).toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { detail = nil } } } }
        }
    }

    private var yearRange: String {
        guard let first = store.stats.years.last, let last = store.stats.years.first else { return "" }
        return first == last ? first : "\(first) — \(last)"
    }

    private func atlasHero(compact: Bool) -> some View {
        ZStack(alignment: .topLeading) {
            RouteAtlas(flights: store.flights, airports: store.airports)
                .padding(.top, compact ? 76 : 55)
                .padding(.bottom, 26)
            LinearGradient(colors: [.black.opacity(0.6), .clear, .black.opacity(0.35)], startPoint: .top, endPoint: .bottom)
            VStack(alignment: .leading, spacing: 4) {
                Text("THE WORLD, BY YOU").font(.system(size: 10, weight: .medium, design: .monospaced)).tracking(2.5).foregroundStyle(.white.opacity(0.55))
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text(store.stats.miles.formatted()).font(.system(size: compact ? 42 : 50, weight: .light, design: .rounded)).tracking(-2)
                    Text("miles").font(.subheadline).foregroundStyle(.white.opacity(0.6))
                }.accessibilityElement(children: .combine).accessibilityIdentifier("totalMiles")
                Spacer()
                HStack {
                    HStack(spacing: 6) { Circle().fill(.white).frame(width: 4, height: 4); Text("\(store.stats.routes) routes across \(store.stats.countryCodes.count) countries") }
                    Spacer()
                    Image(systemName: "location.north.circle").font(.title3.weight(.ultraLight))
                }.font(.system(size: 10, weight: .medium, design: .monospaced)).foregroundStyle(.white.opacity(0.65))
            }.foregroundStyle(.white).padding(24)
        }.background(AMStyle.map)
            .overlay { RoundedRectangle(cornerRadius: 26).strokeBorder(.white.opacity(0.10), lineWidth: 0.5) }
    }

    private var metricStrip: some View {
        HStack(spacing: 0) {
            Metric(value: "\(store.flights.count)", label: "Flights", symbol: "airplane")
            Divider().frame(height: 36)
            Metric(value: "\(store.stats.airportCodes.count)", label: "Airports", symbol: "mappin.and.ellipse")
            Divider().frame(height: 36)
            Metric(value: "\(store.stats.countryCodes.count)", label: "Countries", symbol: "globe.europe.africa")
        }.padding(.vertical, 18).panel()
    }

    private func recentFlights(limit: Int) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("Recent flights").font(.title3.bold())
                Spacer()
                Button { showFlights() } label: { HStack(spacing: 4) { Text("View all"); Image(systemName: "arrow.up.right") } }.font(.caption.weight(.semibold)).accessibilityIdentifier("viewAllFlights")
            }
            VStack(spacing: 0) {
                ForEach(Array(store.flights.prefix(limit))) { flight in
                    Button { detail = flight } label: { FlightRow(flight: flight) }.buttonStyle(.plain)
                    if flight.id != store.flights.prefix(limit).last?.id { Divider().padding(.horizontal, 18) }
                }
            }.panel()
        }
    }

    private var milestone: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("A little perspective").font(.title3.bold())
            HStack(alignment: .center, spacing: 18) {
                Image(systemName: "globe.americas").font(.system(size: 44, weight: .ultraLight)).foregroundStyle(.secondary)
                VStack(alignment: .leading, spacing: 5) {
                    Text("\(store.stats.earthLaps.formatted(.number.precision(.fractionLength(1)))) times around Earth")
                        .font(.title3.weight(.semibold)).fixedSize(horizontal: false, vertical: true)
                    Text("And a few stories along the way.").font(.caption).foregroundStyle(.secondary)
                }
                Spacer(minLength: 0)
            }.padding(22).frame(maxWidth: .infinity, alignment: .leading).panel()
        }
    }
}

struct Metric: View {
    var value: String
    var label: String
    var symbol: String
    var body: some View {
        VStack(spacing: 7) {
            Text(value).font(.system(size: 28, weight: .semibold, design: .rounded))
            Label(label, systemImage: symbol).font(.system(size: 10, weight: .medium)).foregroundStyle(.secondary)
        }.frame(maxWidth: .infinity).accessibilityElement(children: .combine)
    }
}

private struct HingeObserver: ViewModifier {
    @Binding var tabletop: Bool
    @ViewBuilder func body(content: Content) -> some View {
        #if compiler(>=6.4)
        if #available(iOS 27.1, *) {
            content.onHingeChange { _, update in tabletop = update.hinge?.status == .partiallyOpen }
        } else { content }
        #else
        content
        #endif
    }
}
