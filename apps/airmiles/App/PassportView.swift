import AirMilesCore
import Charts
import SwiftUI

struct PassportView: View {
    @Environment(FlightStore.self) private var store
    @State private var year: String?
    @ScaledMetric(relativeTo: .largeTitle) private var distanceSize = 42
    private var flights: [Flight] { store.flights.filter { year == nil || $0.year == year } }
    private var stats: FlightStats { FlightStats(flights: flights, airports: store.airports) }

    var body: some View {
        GeometryReader { geometry in
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    HStack {
                        Text("Passport").font(.largeTitle.bold())
                        Spacer()
                        Menu {
                            Button("All time") { year = nil }
                            ForEach(store.stats.years, id: \.self) { value in Button(value) { year = value } }
                        } label: { Label(year ?? "All time", systemImage: "chevron.down").font(.subheadline) }
                    }
                    if geometry.size.width > 700 {
                        HStack(alignment: .top, spacing: 24) {
                            summary.frame(maxWidth: .infinity)
                            annualChart.frame(maxWidth: .infinity)
                        }
                        HStack(alignment: .top, spacing: 24) {
                            topAirports.frame(maxWidth: .infinity)
                            countries.frame(maxWidth: .infinity)
                        }
                    } else {
                        summary
                        annualChart
                        topAirports
                        countries
                    }
                    if let longest = stats.longest {
                        HStack(spacing: 16) {
                            AirlineLogo(airline: longest.airline, size: 32)
                            VStack(alignment: .leading, spacing: 6) {
                                Text("Longest flight").font(.caption).foregroundStyle(.secondary)
                                Text(longest.route).font(.title3.weight(.semibold))
                            }
                            Spacer()
                            Text("\(longest.miles.formatted()) mi").font(.subheadline).foregroundStyle(.secondary)
                        }.padding(20).panel()
                    }
                    Text("\(stats.needsReview) flights have uncertain details. Countries include connections.")
                        .font(.caption).foregroundStyle(.secondary)
                }.padding(24).frame(maxWidth: 1100).frame(maxWidth: .infinity)
            }
        }.background(AMStyle.paper).navigationBarTitleDisplayMode(.inline)
    }

    private var summary: some View {
        VStack(alignment: .leading, spacing: 24) {
            VStack(alignment: .leading, spacing: 6) {
                Text("Total distance").font(.subheadline).foregroundStyle(.secondary)
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text(stats.miles.formatted()).font(.system(size: distanceSize, weight: .medium)).tracking(-1.5).minimumScaleFactor(0.6)
                    Text("mi").font(.title3).foregroundStyle(.secondary)
                }
            }
            HStack(spacing: 0) {
                Metric(value: "\(flights.count)", label: "Flights")
                Metric(value: "\(stats.airportCodes.count)", label: "Airports")
                Metric(value: "\(stats.countryCodes.count)", label: "Countries")
            }
        }.padding(.vertical, 16)
    }

    private var annualChart: some View {
        VStack(alignment: .leading, spacing: 18) {
            Text("Flights by year").font(.headline)
            Chart(store.stats.years.sorted(), id: \.self) { value in
                BarMark(x: .value("Year", value), y: .value("Flights", store.flights.filter { $0.year == value }.count), width: .ratio(0.5))
                    .cornerRadius(3)
                    .foregroundStyle(year == nil || value == year ? Color.primary : Color.secondary.opacity(0.2))
                    .annotation(position: .top) {
                        Text("\(store.flights.filter { $0.year == value }.count)").font(.caption2).foregroundStyle(.secondary)
                    }
            }.chartYAxis(.hidden)
                .chartXAxis {
                    AxisMarks(values: store.stats.years.sorted()) { value in
                        AxisValueLabel {
                            if let year = value.as(String.self) {
                                Text(String(year.suffix(2))).font(.system(size: 11))
                                    .accessibilityLabel(year)
                            }
                        }
                    }
                }
                .frame(height: 120).chartXSelection(value: $year)
        }.padding(20).panel()
    }

    private var topAirports: some View {
        VStack(alignment: .leading, spacing: 18) {
            Text("Top airports").font(.headline)
            ForEach(Array(stats.topAirports.prefix(5)), id: \.code) { entry in
                HStack(spacing: 14) {
                    Text(entry.code).font(.headline).frame(width: 42, alignment: .leading)
                    VStack(alignment: .leading, spacing: 6) {
                        Text(store.city(entry.code)).font(.subheadline)
                        GeometryReader { proxy in
                            Capsule().fill(Color.primary.opacity(0.08))
                            Capsule().fill(Color.primary.opacity(0.5))
                                .frame(width: proxy.size.width * Double(entry.count) / Double(stats.topAirports.first?.count ?? 1))
                        }.frame(height: 3)
                    }
                    Text("\(entry.count)").font(.subheadline.monospacedDigit()).foregroundStyle(.secondary)
                }
            }
            Text("Arrivals + departures").font(.caption).foregroundStyle(.secondary)
        }.padding(20).panel()
    }

    private var countries: some View {
        VStack(alignment: .leading, spacing: 18) {
            Text("Countries").font(.headline)
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 140))], alignment: .leading, spacing: 16) {
                ForEach(stats.countryCodes.sorted(), id: \.self) { code in
                    HStack(spacing: 10) {
                        Text(code).font(.caption.weight(.semibold))
                            .frame(width: 32, height: 32).background(Color.primary.opacity(0.06), in: Circle())
                        Text(store.airports.values.first { $0.country == code }?.countryName ?? code)
                            .font(.caption).fixedSize(horizontal: false, vertical: true)
                    }.frame(maxWidth: .infinity, alignment: .leading)
                }
            }
        }.padding(20).panel()
    }
}
