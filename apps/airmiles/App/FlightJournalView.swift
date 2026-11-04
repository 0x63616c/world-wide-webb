import AirMilesCore
import SwiftUI

struct FlightRow: View {
    @Environment(FlightStore.self) private var store
    var flight: Flight
    var selected = false
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text(flight.displayDate).font(.system(size: 10, weight: .medium, design: .monospaced)).foregroundStyle(.secondary)
                Spacer()
                Text(flight.number == "?" ? flight.airline : flight.number).font(.system(size: 10, weight: .medium, design: .monospaced)).lineLimit(1).foregroundStyle(.secondary)
            }
            HStack(spacing: 16) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(flight.origin).font(.system(size: 25, weight: .semibold, design: .rounded))
                    Text(store.city(flight.origin)).font(.caption2).foregroundStyle(.secondary).lineLimit(1)
                }.frame(maxWidth: .infinity, alignment: .leading)
                HStack(spacing: 6) {
                    Rectangle().fill(.secondary.opacity(0.3)).frame(width: 16, height: 0.5)
                    Image(systemName: "airplane").font(.system(size: 13)).foregroundStyle(.secondary)
                    Rectangle().fill(.secondary.opacity(0.3)).frame(width: 16, height: 0.5)
                }
                VStack(alignment: .trailing, spacing: 3) {
                    Text(flight.destination).font(.system(size: 25, weight: .semibold, design: .rounded))
                    Text(store.city(flight.destination)).font(.caption2).foregroundStyle(.secondary).lineLimit(1)
                }.frame(maxWidth: .infinity, alignment: .trailing)
                Image(systemName: "chevron.right").font(.system(size: 10, weight: .semibold)).foregroundStyle(.tertiary)
            }
        }.padding(18).background(selected ? Color.primary.opacity(0.06) : .clear)
            .contentShape(Rectangle()).accessibilityElement(children: .combine)
            .accessibilityLabel("\(flight.origin) to \(flight.destination), \(flight.airline), \(flight.date)")
    }
}

struct FlightJournalView: View {
    @Environment(FlightStore.self) private var store
    @State private var selectedID: String?
    @State private var compactColumn: NavigationSplitViewColumn = .sidebar
    private var selection: Flight? { store.flights.first { $0.id == selectedID } }

    var body: some View {
        @Bindable var store = store
        NavigationSplitView(preferredCompactColumn: $compactColumn) {
            VStack(spacing: 0) {
                HStack {
                    Menu {
                        Button("All years") { store.selectedYear = nil }
                        ForEach(store.stats.years, id: \.self) { year in Button(year) { store.selectedYear = year } }
                    } label: { Label(store.selectedYear ?? "All years", systemImage: "calendar").font(.subheadline.weight(.medium)) }
                        .accessibilityIdentifier("yearFilter")
                    Spacer()
                    Button { store.reviewOnly.toggle() } label: {
                        Image(systemName: store.reviewOnly ? "line.3.horizontal.decrease.circle.fill" : "line.3.horizontal.decrease.circle")
                    }.accessibilityLabel("Needs review").accessibilityValue(store.reviewOnly ? "On" : "Off")
                }.padding(.horizontal, 20).padding(.vertical, 12)
                HStack {
                    Eyebrow("\(store.filtered.count) flights")
                    Spacer()
                    Text("\(store.filtered.reduce(0) { $0 + $1.miles }.formatted()) mi").font(.caption.monospaced()).foregroundStyle(.secondary)
                }.padding(.horizontal, 20).padding(.bottom, 12)
                if store.filtered.isEmpty {
                    ContentUnavailableView.search(text: store.query)
                        .overlay(alignment: .bottom) {
                            Button("Clear filters") { store.query = ""; store.selectedYear = nil; store.reviewOnly = false }.padding(20)
                        }
                } else {
                    List(selection: $selectedID) {
                        ForEach(Set(store.filtered.map(\.year)).sorted(by: >), id: \.self) { year in
                            Section {
                                ForEach(store.filtered.filter { $0.year == year }) { flight in
                                    NavigationLink(value: flight.id) { FlightRow(flight: flight, selected: selectedID == flight.id) }
                                        .listRowInsets(EdgeInsets()).listRowBackground(AMStyle.card)
                                        .accessibilityIdentifier("flight-\(flight.id)")
                                }
                            } header: { Text(year).font(.headline).foregroundStyle(.primary) }
                        }
                    }.listStyle(.insetGrouped).scrollContentBackground(.hidden)
                }
            }.background(AMStyle.paper).navigationTitle("Flights")
                .searchable(text: $store.query, prompt: "City, airport, airline")
                .navigationSplitViewColumnWidth(min: 290, ideal: 340, max: 420)
        } detail: {
            if let selection {
                FlightDetailView(flight: selection)
                    .toolbar {
                        ToolbarItem(placement: .topBarLeading) {
                            Button { compactColumn = .sidebar; selectedID = nil } label: {
                                Label("All flights", systemImage: "list.bullet")
                            }
                        }
                    }
            } else {
                VStack(spacing: 24) {
                    RouteAtlas(flights: store.filtered, airports: store.airports).frame(height: 290).clipShape(RoundedRectangle(cornerRadius: 26))
                    Text("Every flight, remembered.").font(.title2.bold())
                    Text("Choose a flight to explore its story.").foregroundStyle(.secondary)
                }.padding(28).frame(maxWidth: .infinity, maxHeight: .infinity).background(AMStyle.paper)
            }
        }
        .navigationSplitViewStyle(.balanced)
        .onChange(of: selectedID) { _, value in if value != nil { compactColumn = .detail } }
        .onChange(of: store.flights) { _, newFlights in
            if !newFlights.contains(where: { $0.id == selectedID }) { selectedID = nil }
        }
    }
}

struct FlightDetailView: View {
    @Environment(FlightStore.self) private var store
    var flight: Flight
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                RouteAtlas(flights: [flight], airports: store.airports, emphasized: flight)
                    .frame(height: 240).clipShape(RoundedRectangle(cornerRadius: 24))
                VStack(alignment: .leading, spacing: 24) {
                    HStack {
                        Eyebrow("Flight memory")
                        Spacer()
                        Image(systemName: "airplane").foregroundStyle(.secondary)
                    }
                    HStack(alignment: .top) {
                        airport(flight.origin, alignment: .leading)
                        Spacer()
                        Image(systemName: "arrow.right").font(.title3.weight(.light)).padding(.top, 14).foregroundStyle(.secondary)
                        Spacer()
                        airport(flight.destination, alignment: .trailing)
                    }
                    DottedRule().stroke(style: StrokeStyle(lineWidth: 1, dash: [3, 5])).foregroundStyle(.secondary.opacity(0.25)).frame(height: 1)
                    HStack(alignment: .top) {
                        info("Date", value: flight.displayDate)
                        Spacer()
                        info("Distance", value: "\(flight.miles.formatted()) mi")
                    }
                    HStack(alignment: .top) {
                        info("Airline", value: flight.airline)
                        Spacer(minLength: 24)
                        info("Flight", value: flight.flightNumber)
                    }
                }.padding(24).panel()
                VStack(alignment: .leading, spacing: 10) {
                    Label(flight.confidence.label, systemImage: flight.confidence == .high ? "checkmark.seal" : "questionmark.circle").font(.subheadline.weight(.semibold))
                    Text(flight.confidence == .high ? "Imported from your flight history. Flight times, seats and aircraft weren’t recorded." : "This record contains uncertain details in the original import. The airline and flight number are shown as recorded.")
                        .font(.footnote).foregroundStyle(.secondary)
                    Text("Distance is a great-circle estimate, not the actual flown track.").font(.caption).foregroundStyle(.tertiary)
                }.padding(22).panel()
            }.padding(20).frame(maxWidth: 740).frame(maxWidth: .infinity)
        }.background(AMStyle.paper).navigationTitle(flight.route).navigationBarTitleDisplayMode(.inline)
    }
    private func airport(_ code: String, alignment: HorizontalAlignment) -> some View {
        VStack(alignment: alignment, spacing: 6) {
            Text(code).font(.system(size: 39, weight: .semibold, design: .rounded)).tracking(-1)
            Text(store.city(code)).font(.subheadline).foregroundStyle(.secondary)
            Text(store.airports[code]?.countryName ?? "Unknown airport").font(.caption).foregroundStyle(.tertiary)
        }
    }
    private func info(_ title: String, value: String) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Eyebrow(title)
            Text(value).font(.subheadline.weight(.medium)).fixedSize(horizontal: false, vertical: true)
        }.frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct DottedRule: Shape {
    func path(in rect: CGRect) -> Path { Path { $0.move(to: .zero); $0.addLine(to: CGPoint(x: rect.width, y: 0)) } }
}
