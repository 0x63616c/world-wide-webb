import AirMilesCore
import SwiftUI

struct OverviewView: View {
    @Environment(FlightStore.self) private var store
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var detail: Flight?
    @State private var tabletop = false
    @State private var spinning = true
    @ScaledMetric(relativeTo: .largeTitle) private var distanceSize = 44
    var showFlights: () -> Void

    var body: some View {
        GeometryReader { geometry in
            if tabletop && geometry.size.width > 550 {
                VStack(spacing: 0) {
                    globe.frame(height: geometry.size.height * 0.47)
                    ScrollView {
                        HStack(alignment: .top, spacing: 32) {
                            VStack(alignment: .leading, spacing: 24) { distance; metricStrip }
                                .frame(maxWidth: .infinity)
                            recentFlights(limit: 2).frame(maxWidth: .infinity)
                        }.padding(24)
                    }
                }
            } else {
                ScrollView {
                    VStack(alignment: .leading, spacing: 24) {
                        if store.isDemo { Text("Sample flights").font(.caption).foregroundStyle(.secondary) }
                        if geometry.size.width > 700 {
                            HStack(alignment: .top, spacing: 40) {
                                VStack(alignment: .leading, spacing: 12) {
                                    distance
                                    globe.frame(height: 280)
                                    metricStrip
                                }.frame(maxWidth: .infinity)
                                recentFlights(limit: 3).frame(maxWidth: .infinity)
                            }
                        } else {
                            distance
                            globe.frame(height: 260)
                            metricStrip
                            recentFlights(limit: 3)
                        }
                    }.padding(.horizontal, geometry.size.width > 600 ? 28 : 20)
                        .padding(.top, 12).padding(.bottom, 24)
                        .frame(maxWidth: 1100).frame(maxWidth: .infinity)
                }
            }
        }
        .background(AMStyle.paper)
        .navigationBarTitleDisplayMode(.inline)
        .modifier(HingeObserver(tabletop: $tabletop))
        .sheet(item: $detail) { flight in
            NavigationStack { FlightDetailView(flight: flight).toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { detail = nil } } } }
        }
    }

    private var distance: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Total distance").font(.subheadline).foregroundStyle(.secondary)
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(store.stats.miles.formatted()).font(.system(size: distanceSize, weight: .medium)).tracking(-1.5).minimumScaleFactor(0.7)
                Text("mi").font(.title3).foregroundStyle(.secondary)
            }.accessibilityElement(children: .combine).accessibilityIdentifier("totalMiles")
        }
    }

    private var globe: some View {
        RouteAtlas(flights: store.flights, airports: store.airports, spinning: spinning)
            .overlay(alignment: .bottomTrailing) {
                if !reduceMotion {
                    Button { spinning.toggle() } label: {
                        Image(systemName: spinning ? "pause" : "play")
                            .font(.system(size: 12, weight: .medium))
                            .frame(width: 44, height: 44)
                            .background(.thinMaterial, in: Circle())
                    }.buttonStyle(.plain)
                        .accessibilityLabel(spinning ? "Pause globe" : "Rotate globe")
                        .accessibilityIdentifier("globeMotion")
                }
            }
    }

    private var metricStrip: some View {
        HStack(spacing: 0) {
            Metric(value: "\(store.flights.count)", label: "Flights")
            Divider().frame(height: 28)
            Metric(value: "\(store.stats.airportCodes.count)", label: "Airports")
            Divider().frame(height: 28)
            Metric(value: "\(store.stats.countryCodes.count)", label: "Countries")
        }.padding(.vertical, 16)
    }

    private func recentFlights(limit: Int) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack {
                Text("Recent flights").font(.title3.weight(.semibold))
                Spacer()
                Button("See all") { showFlights() }.font(.subheadline).accessibilityIdentifier("viewAllFlights")
            }.padding(.top, 4)
            VStack(spacing: 0) {
                ForEach(Array(store.flights.prefix(limit))) { flight in
                    Button { detail = flight } label: { FlightRow(flight: flight) }.buttonStyle(.plain)
                    if flight.id != store.flights.prefix(limit).last?.id { Divider().padding(.horizontal, 18) }
                }
            }.panel()
        }
    }
}

struct Metric: View {
    var value: String
    var label: String
    var body: some View {
        VStack(spacing: 5) {
            Text(value).font(.title2.weight(.semibold))
            Text(label).font(.caption).foregroundStyle(.secondary)
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
