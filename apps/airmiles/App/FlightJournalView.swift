import AirMilesCore
import SwiftUI

struct FlightRow: View {
    @Environment(FlightStore.self) private var store
    var flight: Flight
    var selected = false
    @ScaledMetric(relativeTo: .title2) private var codeSize = 25
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 8) {
                AirlineLogo(airline: flight.airline)
                Text(flight.number == "?" ? flight.airline : flight.number)
                    .font(.caption.weight(.medium)).lineLimit(1).foregroundStyle(.secondary)
                Spacer()
                Text(flight.displayDate).font(.caption).foregroundStyle(.secondary)
            }
            HStack(spacing: 16) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(flight.origin).font(.system(size: codeSize, weight: .semibold))
                    Text(store.city(flight.origin)).font(.caption2).foregroundStyle(.secondary).lineLimit(1)
                }.frame(maxWidth: .infinity, alignment: .leading)
                HStack(spacing: 6) {
                    Rectangle().fill(.secondary.opacity(0.3)).frame(width: 16, height: 0.5)
                    Image(systemName: "airplane").font(.system(size: 13)).foregroundStyle(.secondary)
                    Rectangle().fill(.secondary.opacity(0.3)).frame(width: 16, height: 0.5)
                }
                VStack(alignment: .trailing, spacing: 3) {
                    Text(flight.destination).font(.system(size: codeSize, weight: .semibold))
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
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
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
                    Menu {
                        Toggle("Uncertain details", isOn: $store.reviewOnly)
                    } label: {
                        Label(store.reviewOnly ? "Uncertain details" : "Filter", systemImage: "line.3.horizontal.decrease")
                            .font(.subheadline)
                    }.accessibilityLabel("Filter flights")
                }.padding(.horizontal, 20).padding(.vertical, 12)
                HStack {
                    Eyebrow("\(store.filtered.count) \(store.filtered.count == 1 ? "flight" : "flights")")
                    Spacer()
                    Text("\(store.filtered.reduce(0) { $0 + $1.miles }.formatted()) mi").font(.caption).foregroundStyle(.secondary)
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
                FlightDetailView(flight: selection, sharedGlobe: true)
                    .toolbar {
                        ToolbarItem(placement: .topBarLeading) {
                            Button { compactColumn = .sidebar; selectedID = nil } label: {
                                Label("All flights", systemImage: "list.bullet")
                            }
                        }
                    }
            } else {
                VStack(spacing: 24) {
                    GlobeSlot(id: "journal", flights: store.filtered, height: 290).clipShape(RoundedRectangle(cornerRadius: 26))
                    Text("Select a flight").font(.headline).foregroundStyle(.secondary)
                }.padding(28).frame(maxWidth: .infinity, maxHeight: .infinity).background(AMStyle.paper)
            }
        }
        .navigationSplitViewStyle(.balanced)
        .transformPreference(GlobePlacementKey.self) { slots in
            if horizontalSizeClass == .compact && compactColumn == .sidebar {
                slots.removeValue(forKey: "journal")
            }
        }
        .onChange(of: selectedID) { _, value in if value != nil { compactColumn = .detail } }
        .onChange(of: store.flights) { _, newFlights in
            if !newFlights.contains(where: { $0.id == selectedID }) { selectedID = nil }
        }
    }
}

struct FlightDetailView: View {
    @ScaledMetric(relativeTo: .largeTitle) private var codeSize = 36
    @Environment(FlightStore.self) private var store
    var flight: Flight
    var sharedGlobe = false
    @State private var localGlobe = GlobeInteraction()
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                Group {
                    if sharedGlobe { GlobeSlot(id: "journal", flights: [flight], emphasized: flight, height: 190) }
                    else {
                        RouteAtlas(flights: [flight], airports: store.airports, emphasized: flight, spinning: false, interaction: localGlobe)
                            .modifier(GlobeFrame(baseHeight: 190, interaction: localGlobe))
                    }
                }.clipShape(RoundedRectangle(cornerRadius: 24))
                VStack(alignment: .leading, spacing: 18) {
                    HStack(spacing: 10) {
                        AirlineLogo(airline: flight.airline, size: 30)
                        Text(flight.airline).font(.subheadline.weight(.medium))
                        Spacer()
                        Text(flight.flightNumber).font(.subheadline).foregroundStyle(.secondary)
                    }.accessibilityIdentifier("flightIdentity")
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
                }.padding(24).panel()
                if let operation = store.enrichment?.operation(for: flight) {
                    OperationDetails(operation: operation)
                }
                VStack(alignment: .leading, spacing: 8) {
                    if flight.confidence != .high {
                        Label(flight.confidence.label, systemImage: "questionmark.circle")
                            .font(.subheadline.weight(.medium))
                        Text("Airline and flight number are shown as imported.")
                            .font(.footnote).foregroundStyle(.secondary)
                    }
                    Text("Distance is a great-circle estimate.").font(.caption).foregroundStyle(.secondary)
                }.padding(.horizontal, 4)

            }.padding(20).frame(maxWidth: 740).frame(maxWidth: .infinity)
        }.modifier(GlobeClipRegion()).background(AMStyle.paper).navigationTitle(flight.route).navigationBarTitleDisplayMode(.inline)
    }
    private func airport(_ code: String, alignment: HorizontalAlignment) -> some View {
        VStack(alignment: alignment, spacing: 6) {
            Text(code).font(.system(size: codeSize, weight: .semibold)).tracking(-1)
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

private struct OperationDetails: View {
    let operation: FlightOperation
    @State private var expanded = false
    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack(alignment: .top) {
                time("Departure", actual: operation.actualDeparture, scheduled: operation.scheduledDeparture)
                Spacer()
                time("Arrival", actual: operation.safeArrival, scheduled: operation.scheduledArrival)
            }
            HStack {
                if let summary = operation.arrivalSummary {
                    Text(summary).font(.subheadline.weight(.medium))
                }
                Spacer()
                if let duration = operation.duration { Text(duration).font(.subheadline).foregroundStyle(.secondary) }
            }
            DisclosureGroup("Flight details", isExpanded: $expanded) {
                VStack(spacing: 12) {
                    if let tail = operation.tailNumber { LabeledContent("Tail number", value: tail) }
                    if !operation.operatingCarrier.isEmpty {
                        LabeledContent("Operating flight", value: operation.operatingCarrier + operation.operatingFlightNumber)
                    }
                    if let delay = operation.departureDelay {
                        LabeledContent("Departure", value: delay == 0 ? "On time" : "\(abs(delay)) min \(delay < 0 ? "early" : "late")")
                    }
                    if !operation.cancelled && !operation.diverted, let minutes = operation.airborneMinutes {
                        LabeledContent("In the air", value: "\(minutes / 60)h \(minutes % 60)m")
                    }
                    if let url = URL(string: operation.sourceURL) {
                        Link(operation.source == "Sample" ? "Synthetic sample" : "Bureau of Transportation Statistics", destination: url)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }.font(.footnote).padding(.top, 12)
            }.font(.subheadline).accessibilityIdentifier("operationDetails")
            Text("Local airport times · \(operation.source)").font(.caption).foregroundStyle(.secondary)
        }.padding(22).panel()
    }
    private func time(_ title: String, actual: String?, scheduled: String?) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title).font(.caption).foregroundStyle(.secondary)
            if let actual { Text(actual).font(.title2.weight(.medium)).monospacedDigit() }
            if let scheduled { Text("Scheduled \(scheduled)").font(.caption).foregroundStyle(.secondary) }
        }.frame(maxWidth: .infinity, alignment: .leading)
    }
}
