import AirMilesCore
import Charts
import SwiftUI

struct PassportView: View {
    @Environment(FlightStore.self) private var store
    @State private var year: String?
    private var flights: [Flight] { store.flights.filter { year == nil || $0.year == year } }
    private var stats: FlightStats { FlightStats(flights: flights, airports: store.airports) }
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                HStack(alignment: .bottom) {
                    VStack(alignment: .leading, spacing: 6) {
                        Eyebrow("The places that make you")
                        Text("Your passport.").font(.system(size: 32, weight: .bold, design: .rounded)).tracking(-1)
                    }
                    Spacer()
                    Menu {
                        Button("All time") { year = nil }
                        ForEach(store.stats.years, id: \.self) { value in Button(value) { year = value } }
                    } label: { Label(year ?? "All time", systemImage: "chevron.down").font(.caption.weight(.semibold)) }
                }
                VStack(alignment: .leading, spacing: 20) {
                    Eyebrow("Distance travelled").foregroundStyle(.white.opacity(0.65))
                    HStack(alignment: .firstTextBaseline) {
                        Text(stats.miles.formatted()).font(.system(size: 54, weight: .light, design: .rounded)).tracking(-2).minimumScaleFactor(0.6)
                        Text("miles").foregroundStyle(.white.opacity(0.55))
                    }
                    HStack {
                        passportMetric("Flights", "\(flights.count)")
                        passportMetric("Airports", "\(stats.airportCodes.count)")
                        passportMetric("Countries", "\(stats.countryCodes.count)")
                    }
                }.padding(26).foregroundStyle(.white).background(AMStyle.ink, in: RoundedRectangle(cornerRadius: 24))

                VStack(alignment: .leading, spacing: 22) {
                    HStack { Text("Through the years").font(.headline); Spacer(); Text("Flights").font(.caption).foregroundStyle(.secondary) }
                    Chart(store.stats.years.sorted(), id: \.self) { value in
                        BarMark(x: .value("Year", value), y: .value("Flights", store.flights.filter { $0.year == value }.count), width: .ratio(0.5))
                            .cornerRadius(4).foregroundStyle(year == nil || value == year ? Color.primary : Color.secondary.opacity(0.2))
                    }.chartYAxis(.hidden).chartXAxis { AxisMarks { _ in AxisValueLabel().font(.system(size: 9, design: .monospaced)) } }
                        .frame(height: 150)
                        .chartXSelection(value: $year)
                    Text("Tap a year to explore it.").font(.caption).foregroundStyle(.secondary)
                }.padding(22).panel()

                VStack(alignment: .leading, spacing: 18) {
                    Text("Familiar places").font(.headline)
                    ForEach(Array(stats.topAirports.prefix(5)), id: \.code) { entry in
                        HStack(spacing: 16) {
                            Text(entry.code).font(.system(.title3, design: .rounded, weight: .bold)).frame(width: 48, alignment: .leading)
                            VStack(alignment: .leading, spacing: 6) {
                                Text(store.city(entry.code)).font(.subheadline)
                                GeometryReader { proxy in
                                    Capsule().fill(Color.primary.opacity(0.08))
                                    Capsule().fill(Color.primary.opacity(0.5)).frame(width: proxy.size.width * Double(entry.count) / Double(stats.topAirports.first?.count ?? 1))
                                }.frame(height: 3)
                            }
                            Text("\(entry.count)").font(.subheadline.monospacedDigit()).foregroundStyle(.secondary).frame(width: 28, alignment: .trailing)
                        }
                    }
                    Text("Arrivals and departures combined.").font(.caption2).foregroundStyle(.tertiary)
                }.padding(22).panel()

                VStack(alignment: .leading, spacing: 16) {
                    Text("Across borders").font(.headline)
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 135))], alignment: .leading, spacing: 12) {
                        ForEach(stats.countryCodes.sorted(), id: \.self) { code in
                            HStack(spacing: 10) {
                                Text(code).font(.system(size: 12, weight: .bold, design: .monospaced)).padding(10).overlay { Circle().stroke(.secondary.opacity(0.3), style: StrokeStyle(lineWidth: 1, dash: [2, 2])) }
                                Text(store.airports.values.first { $0.country == code }?.countryName ?? code).font(.caption.weight(.medium))
                            }.padding(.vertical, 4)
                        }
                    }
                }.padding(22).panel()
                if let longest = stats.longest {
                    HStack {
                        VStack(alignment: .leading, spacing: 8) {
                            Eyebrow("Longest journey")
                            Text(longest.route).font(.title2.weight(.semibold))
                            Text("\(longest.miles.formatted()) miles · \(longest.airline)").font(.caption).foregroundStyle(.secondary)
                        }
                        Spacer()
                        Image(systemName: "airplane.departure").font(.system(size: 28, weight: .ultraLight))
                    }.padding(24).panel()
                }
                Text("Based on imported records, including \(stats.needsReview) with uncertain details. Country totals count airport locations, including connections.")
                    .font(.caption).foregroundStyle(.secondary).padding(.horizontal, 4)
            }.padding(24).frame(maxWidth: 800).frame(maxWidth: .infinity)
        }.background(AMStyle.paper).navigationBarTitleDisplayMode(.inline)
    }
    private func passportMetric(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(value).font(.system(size: 25, weight: .medium, design: .rounded))
            Text(label).font(.caption).foregroundStyle(.white.opacity(0.55))
        }.frame(maxWidth: .infinity, alignment: .leading)
    }
}
