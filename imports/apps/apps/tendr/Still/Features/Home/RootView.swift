import RDesign
import SwiftUI
import Charts

struct RootView: View {
    @Environment(Store.self) private var store
    @Environment(\.scenePhase) private var scenePhase
    @State private var selected = 0
    @State private var medicationVisit = 0
    @State private var journalFilter = "All"
    var body: some View {
        sectionTabs
            .modifier(NativeTabPlacement())
            .onChange(of: selected) { _, section in
                // Returning to Home starts its charts live; folding is not a new visit.
                if section == 0 { medicationVisit += 1 }
            }
            .alert("Something needs attention", isPresented: Binding(get: { store.error != nil }, set: { if !$0 { store.error = nil } })) {
                Button("OK") { store.error = nil }
            } message: { Text(store.error ?? "") }
            .preferredColorScheme(store.journal.appearance == "dark" ? .dark : store.journal.appearance == "light" ? .light : nil)
            .task {
                await store.refreshHealthKit()
                await store.syncReminders()
            }
            .onChange(of: scenePhase) { _, phase in
                if phase == .active { Task { await store.refreshHealthKit() } }
            }
    }

    private var sectionTabs: some View {
        TabView(selection: $selected) {
            Group {
                TodayView(tab: $selected).environment(\.medicationVisit, medicationVisit).tag(0).tabItem { Label("Home", systemImage: "square.grid.2x2.fill").accessibilityIdentifier("navHome") }
                TreatmentView(tab: $selected, journalFilter: $journalFilter).tag(1).tabItem { Label("Treatment", systemImage: "syringe.fill").accessibilityIdentifier("navTreatment") }
                ProgressViewScreen().tag(2).tabItem { Label("Progress", systemImage: "chart.xyaxis.line").accessibilityIdentifier("navProgress") }
                JournalView(filter: $journalFilter).tag(3).tabItem { Label("Journal", systemImage: "book.closed").accessibilityIdentifier("navJournal") }
                SettingsView().tag(4).tabItem { Label("Settings", systemImage: "gearshape").accessibilityIdentifier("navSettings") }
            }
        }
    }
}

/// Match Folding's system tab style. Duo chooses its trailing rail while phones
/// keep the native tab bar. A stable host preserves section stacks and drafts.
private struct NativeTabPlacement: ViewModifier {
    @ViewBuilder func body(content: Content) -> some View {
        if #available(iOS 26.0, *) {
            content.tabViewStyle(.tabBarOnly)
                .tabBarMinimizeBehavior(.never)
        } else if #available(iOS 18.0, *) {
            content.tabViewStyle(.tabBarOnly)
        } else {
            content
        }
    }
}

struct TodayView: View {
    @Binding var tab: Int
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @Environment(Store.self) private var store
    @State private var weightSheet = false
    @State private var doseSheet = false
    @State private var scheduleSheet = false
    @State private var vialSheet = false
    private var summaryLayout: AnyLayout {
        dynamicTypeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: 12))
            : AnyLayout(HStackLayout(spacing: 12))
    }
    var homeWeights: [WeightEntry] { store.treatmentWeights.filter { $0.date <= Date() } }
    var summary: WeightSummary { WeightSummary(entries: homeWeights, now: Date()) }
    var overdue: Date? { store.journal.schedule.outstanding(asOf: Date(), doses: store.journal.doses).first }
    var nextDate: Date? { overdue ?? store.journal.schedule.occurrences(after: Date(), count: 1).first }
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    PageHeader("Tendr").padding(.horizontal, 8)
                    summaryLayout {
                        VStack(alignment: .leading, spacing: 12) {
                            Label(overdue == nil ? "Next dose" : "Overdue", systemImage: overdue == nil ? "calendar" : "clock.badge.exclamationmark").font(.caption.weight(.semibold)).foregroundStyle(overdue == nil ? Theme.pine : Theme.pine)
                            if let nextDate {
                                HStack(alignment: .center, spacing: 8) {
                                    Text(nextDate, format: .dateTime.weekday(.wide)).font(.title3.weight(.semibold)).lineLimit(1).minimumScaleFactor(0.8)
                                    Spacer(minLength: 0)
                                    VStack(alignment: .trailing, spacing: 3) {
                                        Text(nextDate, format: .dateTime.month(.abbreviated).day())
                                        Text(nextDate, format: .dateTime.hour().minute())
                                    }.font(.caption).foregroundStyle(.secondary).fixedSize()
                                }.frame(minHeight: 54)
                            } else { Button("Set your schedule") { scheduleSheet = true }.font(.headline) }
                            Button { doseSheet = true } label: { Label("Log dose", systemImage: "plus").font(.subheadline.weight(.semibold)).frame(maxWidth: .infinity).padding(.vertical, 3) }.buttonStyle(.borderedProminent).buttonBorderShape(.capsule).accessibilityIdentifier("logDose")
                        }.frame(maxWidth: .infinity, alignment: .leading).frame(minHeight: 128).card()
                        // Vials are optional; without one, adding a vial lives in Treatment.
                        if let vial = store.journal.vials.sorted(by: { $0.received > $1.received }).first {
                            Button { vialSheet = true } label: { VialMini(vial: vial) }
                                .buttonStyle(.plain).accessibilityLabel("Vial details")
                                .accessibilityIdentifier("vialCard")
                        }
                    }
                    MedicationCard()
                    Button { tab = 2 } label: {
                        VStack(alignment: .leading, spacing: 12) {
                            HStack {
                                Label("Weight", systemImage: "scalemass.fill").font(.subheadline.weight(.semibold)).foregroundStyle(Theme.weight)
                                Spacer()
                                Color.clear.frame(width: 52, height: 52)
                            }
                            HStack(alignment: .center, spacing: 24) {
                                VStack(alignment: .leading, spacing: 5) {
                                    if let latest = summary.latest {
                                        HStack(alignment: .firstTextBaseline, spacing: 4) {
                                            Text(number(store.journal.unit.display(latest))).font(.system(size: 32, weight: .bold, design: .rounded))
                                            Text(store.journal.unit.symbol).font(.subheadline).foregroundStyle(.secondary)
                                        }
                                    } else {
                                        Text("No data").font(.subheadline.weight(.medium)).foregroundStyle(.secondary)
                                    }
                                    Text("Latest").font(.caption).foregroundStyle(.secondary)
                                }
                                WeightChart(entries: homeWeights, unit: store.journal.unit, compact: true, mode: store.journal.weightTrend).frame(height: 65).allowsHitTesting(false)
                            }
                            Divider()
                            HStack {
                                stat(title: (summary.lost ?? 0) >= 0 ? "Total lost" : "Total gained", value: summary.lost.map { number(store.journal.unit.display(abs($0))) }, suffix: store.journal.unit.symbol)
                                Spacer(); Divider().frame(height: 32); Spacer()
                                stat(title: "Weekly change", value: summary.weeklyChange.map { ($0 > 0 ? "+" : "") + number(store.journal.unit.display($0)) }, suffix: store.journal.unit.symbol, alignment: .trailing)
                            }
                        }.card().contentShape(Rectangle())
                    }.buttonStyle(.plain).accessibilityIdentifier("weightCard")
                        .accessibilityHint("Opens Progress")
                        .overlay(alignment: .topTrailing) {
                            Button { weightSheet = true } label: { Image(systemName: "plus.circle.fill").font(.system(size: 30)).frame(width: 52, height: 52) }
                                .padding(20)
                                .accessibilityLabel("Add Weight").accessibilityIdentifier("logWeight")
                        }

                }.padding(.horizontal, 16).padding(.bottom, 24).tendrReadableWidth()
            }.background(Theme.background).tendrRootNavigationBar()
                .sheet(isPresented: $weightSheet) { WeightEditor().tendrSheet() }
                .sheet(isPresented: $doseSheet) { DoseEditor(scheduledDate: nextDate).tendrSheet() }
                .sheet(isPresented: $scheduleSheet) { ScheduleEditor().tendrSheet() }
                .sheet(isPresented: $vialSheet) { VialEditor(vial: store.journal.vials.sorted { $0.received > $1.received }.first).tendrSheet() }
        }
    }
    func stat(title: String, value: String?, suffix: String, alignment: HorizontalAlignment = .leading) -> some View {
        VStack(alignment: alignment, spacing: 4) {
            Text(title).font(.caption).foregroundStyle(.secondary)
            if let value {
                HStack(alignment: .firstTextBaseline, spacing: 3) { Text(value).font(.system(.title3, design: .rounded, weight: .semibold)); Text(suffix).font(.caption).foregroundStyle(.secondary) }
            } else {
                Text("No data").font(.caption.weight(.medium)).foregroundStyle(.secondary)
            }
        }
    }
}

struct WeightChart: View {
    var entries: [WeightEntry]
    var unit: WeightUnit
    @State private var selected: Date?
    var compact = false
    var sorted: [WeightEntry] { entries.sorted { $0.date < $1.date } }
    var mode = WeightTrendMode.default
    var trend: [WeightEntry] { mode.trend(entries) }
    var bounds: ClosedRange<Double> {
        let values = sorted.map { unit.display($0.kilograms) }
        return ((values.min() ?? 0) - 1)...((values.max() ?? 1) + 1)
    }
    var body: some View {
        Chart {
            ForEach(trend) { entry in
                AreaMark(x: .value("Date", entry.date), yStart: .value("Base", bounds.lowerBound), yEnd: .value("Weight", unit.display(entry.kilograms)))
                    .foregroundStyle(LinearGradient(colors: [Theme.weight.opacity(0.18), Theme.weight.opacity(0.01)], startPoint: .top, endPoint: .bottom)).interpolationMethod(interpolation)
                LineMark(x: .value("Date", entry.date), y: .value("Weight", unit.display(entry.kilograms))).foregroundStyle(Theme.weight).lineStyle(StrokeStyle(lineWidth: mode == .raw ? 1.5 : 2.5, lineCap: .round, lineJoin: .round)).interpolationMethod(interpolation)
            }
            ForEach(sorted) { entry in
                PointMark(x: .value("Date", entry.date), y: .value("Weight", unit.display(entry.kilograms))).foregroundStyle(Theme.weight).symbolSize(compact ? 16 : 45)
            }
            if let selected, let nearest = sorted.min(by: { abs($0.date.timeIntervalSince(selected)) < abs($1.date.timeIntervalSince(selected)) }) {
                RuleMark(x: .value("Selected", nearest.date)).foregroundStyle(.secondary.opacity(0.4)).annotation(position: .top) { Text("\(number(unit.display(nearest.kilograms))) \(unit.symbol)").font(.caption.bold()).padding(5).background(Theme.card, in: Capsule()) }
            }
        }.chartXSelection(value: $selected).chartYScale(domain: bounds)
            .chartXScale(range: .plotDimension(padding: compact ? 4 : 20))
            .chartXAxis { if !compact { AxisMarks(values: .automatic(desiredCount: 4)) { _ in AxisValueLabel(format: .dateTime.month(.abbreviated).day()) } } }
            .chartYAxis { if !compact { AxisMarks(position: .leading, values: .automatic(desiredCount: 4)) { _ in AxisGridLine().foregroundStyle(.gray.opacity(0.12)); AxisValueLabel() } } }
            .accessibilityLabel("Weight history in \(unit.symbol): \(mode.title.lowercased()) and recorded weigh-ins")
    }
    /// Curves suit averages; raw readings join point to point so nothing is invented between them.
    private var interpolation: InterpolationMethod { mode == .raw ? .linear : .catmullRom }
}

struct ProgressViewScreen: View {
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    @Environment(\.verticalSizeClass) private var verticalSizeClass
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @Environment(Store.self) private var store
    @State private var range = 90
    @State private var adding = false
    private var metricLayout: AnyLayout {
        dynamicTypeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: 14))
            : AnyLayout(HStackLayout(spacing: 14))
    }
    var entries: [WeightEntry] { store.analyticsWeights.filter { $0.date <= Date() && (range == 0 || $0.date >= Calendar.current.date(byAdding: .day, value: -range, to: Date())!) }.sorted { $0.date < $1.date } }
    var summary: WeightSummary { WeightSummary(entries: entries, now: Date()) }
    var currentWeight: Double? { WeightSummary(entries: store.analyticsWeights, now: Date()).latest }
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    PageHeader("Progress") {
                        Button { adding = true } label: { Image(systemName: "plus.circle.fill").font(.system(size: 30)).frame(width: 52, height: 52) }
                            .accessibilityLabel("Log weight")
                    }.padding(.horizontal, 8)
                    VStack(alignment: .leading, spacing: 12) {
                        Label("Current weight", systemImage: "scalemass.fill").font(.subheadline.weight(.semibold)).foregroundStyle(Theme.weight)
                        if let currentWeight {
                            HStack(alignment: .firstTextBaseline, spacing: 5) {
                                Text(number(store.journal.unit.display(currentWeight))).font(.system(size: 40, weight: .bold, design: .rounded))
                                Text(store.journal.unit.symbol).font(.subheadline).foregroundStyle(.secondary)
                            }
                        } else {
                            Text("No weight recorded").font(.subheadline).foregroundStyle(.secondary)
                        }
                    }.frame(maxWidth: .infinity, alignment: .leading).card().accessibilityIdentifier("currentWeightCard")
                    GoalCard()
                    Text("Weight").font(.title.bold())
                    HStack {
                        FilterBar(selection: $range, options: [(0, "All")])
                        Spacer(minLength: 0)
                        FilterBar(selection: $range, options: [(30, "Month"), (90, "3 months"), (365, "Year")])
                    }
                    VStack(alignment: .leading, spacing: 20) {
                        HStack {
                            Text("WEIGHT TREND").font(.caption.bold()).tracking(1.5).foregroundStyle(.secondary)
                            Spacer()
                            Text(store.journal.weightTrend.title).font(.caption).foregroundStyle(.secondary).accessibilityIdentifier("weightTrendCaption")
                        }
                        if summary.latest != nil {
                            WeightChart(entries: entries, unit: store.journal.unit, mode: store.journal.weightTrend)
                                .frame(height: CGFloat(TendrLayout(horizontal: horizontalSizeClass.map(TendrLayout.SizeClass.init), vertical: verticalSizeClass.map(TendrLayout.SizeClass.init)).weightChartHeight))
                        } else { ContentUnavailableView("Your story starts here", systemImage: "chart.xyaxis.line", description: Text("Add a weight entry to see your history.")) }
                    }.card()
                    metricLayout {
                        metric(title: (summary.lost ?? 0) >= 0 ? "Weight lost" : "Weight gained", value: summary.lost.map { number(store.journal.unit.display(abs($0))) }, foot: store.journal.unit.symbol, icon: "arrow.down.right")
                        metric(title: "Weekly change", value: summary.weeklyChange.map { ($0 > 0 ? "+" : "") + number(store.journal.unit.display($0)) }, foot: "\(store.journal.unit.symbol) / week", icon: "waveform.path")
                    }
                    if let first = entries.first, let lost = summary.lost {
                        HStack { Image(systemName: "circle.lefthalf.filled").foregroundStyle(Theme.pine); Text("\(number(abs(lost) / first.kilograms * 100))% \(lost >= 0 ? "decrease" : "increase") over this period").font(.subheadline) }.padding(18).frame(maxWidth: .infinity, alignment: .leading).rSurface(Theme.sage, cornerRadius: 20)
                    }
                    Text("Based on recorded weights in this period. Weekly change is the average from first to latest entry, not a prediction. Future entries are excluded.").font(.caption).foregroundStyle(.secondary)
                }.padding(.horizontal, 16).padding(.bottom, 24).tendrReadableWidth()
            }.background(Theme.background)
                .tendrRootNavigationBar()
                .sheet(isPresented: $adding) { WeightEditor().tendrSheet() }
        }
    }
    func metric(title: String, value: String?, foot: String, icon: String) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 8) {
                Image(systemName: icon).foregroundStyle(Theme.pine)
                Text(title).font(.caption).foregroundStyle(.secondary)
                Spacer(minLength: 0)
            }
            if let value {
                HStack(alignment: .firstTextBaseline, spacing: 4) {
                    Text(value).font(.system(size: 28, weight: .semibold, design: .rounded)).minimumScaleFactor(0.6).lineLimit(1)
                    Text(foot).font(.caption).foregroundStyle(.secondary).lineLimit(1).minimumScaleFactor(0.7)
                }
            } else {
                Text("No data").font(.subheadline.weight(.medium)).foregroundStyle(.secondary)
            }
        }.frame(maxWidth: .infinity, alignment: .leading).card()
    }
}
