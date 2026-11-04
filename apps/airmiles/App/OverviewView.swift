import AirMilesCore
import SwiftUI

struct OverviewView: View {
    @Environment(FlightStore.self) private var store
    @State private var detail: Flight?
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    @ScaledMetric(relativeTo: .largeTitle) private var distanceSize = 44
    var showFlights: () -> Void

    var body: some View {
        Group {
            #if compiler(>=6.4)
            if #available(iOS 27.1, *), horizontalSizeClass == .regular {
                ArrangementView {
                    DuoOverviewPane {
                        ScrollView {
                            VStack(alignment: .leading, spacing: 20) {
                                sampleLabel
                                distance
                                globe(height: 280)
                                metricStrip
                            }.padding(28)
                        }.modifier(GlobeClipRegion())
                    } vertical: {
                        GeometryReader { geometry in
                            GlobeSlot(id: "overview", flights: store.flights,
                                      height: max(100, geometry.size.height - 40),
                                      maximumHeight: max(100, geometry.size.height - 40))
                                .padding(20)
                        }.modifier(GlobeClipRegion())
                    }.splitArrangementLayoutRatio(0.52)
                } secondary: {
                    DuoOverviewPane {
                        ScrollView { recentFlights(limit: 3).padding(28) }
                    } vertical: {
                        ScrollView {
                            VStack(alignment: .leading, spacing: 20) {
                                sampleLabel
                                distance
                                metricStrip
                                recentFlights(limit: 3)
                            }.padding(28)
                        }
                    }
                }
                .arrangementViewStyle(.split)
            } else { compactOverview }
            #else
            compactOverview
            #endif
        }
        .modifier(GlobeTravelContent())
        .background(AMStyle.paper)
        .navigationBarTitleDisplayMode(.inline)
        .sheet(item: $detail) { flight in
            NavigationStack { FlightDetailView(flight: flight).toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { detail = nil } } } }
        }
    }

    private var compactOverview: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                sampleLabel
                distance
                globe(height: 260)
                metricStrip
                recentFlights(limit: 3)
            }.padding(.horizontal, 20).padding(.top, 12).padding(.bottom, 24)
                .frame(maxWidth: 600).frame(maxWidth: .infinity)
        }.modifier(GlobeClipRegion())
    }

    @ViewBuilder private var sampleLabel: some View {
        if store.isDemo { Text("Sample flights").font(.caption).foregroundStyle(.secondary) }
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

    private func globe(height: CGFloat) -> some View {
        GlobeSlot(id: "overview", flights: store.flights, height: height)
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

#if compiler(>=6.4)
@available(iOS 27.1, *)
private struct DuoOverviewPane<Horizontal: View, Vertical: View>: View {
    @Environment(\.splitArrangementAxis) private var axis
    let horizontal: Horizontal
    let vertical: Vertical
    init(@ViewBuilder horizontal: () -> Horizontal, @ViewBuilder vertical: () -> Vertical) {
        self.horizontal = horizontal()
        self.vertical = vertical()
    }
    var body: some View {
        if axis == .vertical { vertical } else { horizontal }
    }
}
#endif
