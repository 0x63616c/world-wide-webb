import Charts
import RDesign
import SwiftUI

private struct MedicationVisitKey: EnvironmentKey {
  static let defaultValue = 0
}

extension EnvironmentValues {
  /// Changes only on an explicit return to Home, not a window/presentation resize.
  var medicationVisit: Int {
    get { self[MedicationVisitKey.self] }
    set { self[MedicationVisitKey.self] = newValue }
  }
}

struct MedicationCard: View {
  @Environment(\.horizontalSizeClass) private var horizontalSizeClass
  @Environment(\.verticalSizeClass) private var verticalSizeClass
  @Environment(Store.self) private var store
  @Environment(\.medicationVisit) private var medicationVisit
  var expanded = false
  @State private var detail = false
  @State private var selected: Date?
  @State private var info = false
  @State private var now = Date()
  @State private var cachedPlot: MedicationPlot?
  var model: MedicationModel { store.journal.resolvedMedicationModel }
  private func makePlot() -> MedicationPlot {
    MedicationPlot(
      journal: store.journal, start: store.firstDoseDate ?? now, now: now, expanded: expanded)
  }
  var body: some View {
    let plot = cachedPlot ?? makePlot()
    let content = VStack(alignment: .leading, spacing: 8) {
      HStack {
        VStack(alignment: .leading, spacing: 5) {
          Text(store.journal.medication.uppercased()).font(.system(size: 10, weight: .bold))
            .tracking(1.6).foregroundStyle(Theme.pine)
          Text("Estimated level").font(.headline)
        }
        Spacer()
        Button {
          info = true
        } label: {
          Image(systemName: "info.circle").foregroundStyle(.secondary)
        }.accessibilityLabel("About medication estimates")
      }
      // Refresh the digits smoothly; the sampled chart is cached while the selection moves.
      TimelineView(.animation(minimumInterval: 1.0 / 15, paused: selected != nil)) { context in
        let timestamp = selected ?? context.date
        let (value, slope) = plot.levelAndRate(
          at: timestamp, referenceNow: selected == nil ? context.date : plot.now)
        let reference = max(value, plot.referenceDose * 0.1)
        let trend = MedicationLevel.trend(rate: slope, reference: reference)
        HStack(alignment: .firstTextBaseline, spacing: 5) {
          Text(value.formatted(.number.precision(.fractionLength(2)))).font(
            .system(size: 38, weight: .semibold, design: .rounded)
          ).monospacedDigit().accessibilityIdentifier("liveMedicationAmount").minimumScaleFactor(
            0.6
          ).lineLimit(1)
          Text("mg").font(.headline).foregroundStyle(.secondary)
          if trend != 0 {
            HStack(spacing: 1) {
              ForEach(0..<abs(trend), id: \.self) { _ in
                Image(systemName: trend > 0 ? "arrow.up" : "arrow.down")
              }
            }.font(.caption.bold()).foregroundStyle(.secondary)
              .accessibilityLabel(
                "Estimated level " + (abs(trend) == 2 ? "quickly " : "")
                  + (trend > 0 ? "rising" : "falling")
              )
              .accessibilityIdentifier("medicationTrendIndicator")
          }
          Spacer()
          if selected != nil {
            Button("Live") { selected = nil }.font(.caption).buttonStyle(.borderless)
          }
        }
      }
      graph(plot)
      Text("Estimate from your logged doses, not a measured level or medical advice.").font(
        .caption2
      ).foregroundStyle(.secondary).accessibilityIdentifier("estimateDisclaimer")
    }.card().contentShape(Rectangle())
    Group {
      if expanded { content } else { content.onTapGesture { detail = true } }
    }
    .accessibilityElement(children: .contain)
    .accessibilityAddTraits(expanded ? [] : .isButton)
    .accessibilityAction(named: "View details") { if !expanded { detail = true } }
    .accessibilityIdentifier(expanded ? "medicationDetailCard" : "medicationCard")
    .onAppear {
      // Refresh the estimate without clearing a selection when the window adapts.
      now = Date()
      if cachedPlot == nil { cachedPlot = plot }
    }
    .onChange(of: now) { _, _ in cachedPlot = makePlot() }
    .onChange(of: medicationVisit) { _, _ in selected = nil }
    .onChange(of: store.journal) { _, _ in cachedPlot = makePlot() }
    .onReceive(Timer.publish(every: 60, on: .main, in: .common).autoconnect()) { now = $0 }
    .navigationDestination(isPresented: $detail) {
      ScrollView {
        VStack(spacing: 16) {
          MedicationCard(expanded: true)
          MedicationAnalytics()
        }.padding(16).tendrReadableWidth()
      }.background(Theme.background)
        .navigationTitle("Medication").navigationBarTitleDisplayMode(.inline)
        .toolbar(.visible, for: .navigationBar)
    }
    .sheet(isPresented: $info) {
      NavigationStack {
        List {
          Section("An estimate, not a measurement") {
            Text(
              "This graph estimates absorbed medication remaining from your recorded doses. It is not a measured blood level or the exact amount in your body."
            )
            Text(
              "Injection models include gradual absorption, distribution and clearance using published reference parameters. They are not personalised to your body or formulation. Values are rounded because the estimate is approximate. This is not medical advice: do not use the graph to choose or change a dose."
            )
          }
          Section("Projection") {
            Text(
              "The dashed line includes future doses you explicitly entered and, when you have a schedule, the dates it implies. Scheduled doses are drawn at the average of your last three recorded doses, are never counted as already taken, and are not added to your journal. Log each dose as you take it."
            )
          }
          Section("Model") {
            Text(model.title)
            if model == .halfLife {
              Text(
                "Immediate absorption with a \(number(store.journal.halfLifeDays))-day half-life. Choose an injection model in Treatment details to include absorption."
              )
            } else {
              Text(
                "Two compartments with first-order absorption and elimination. The displayed mg excludes medication still at the injection site. Reference profiles are fixed; individual weight, health, injection site and formulation can change the real curve."
              )
            }
            Link(
              "Semaglutide model · Overgaard 2019",
              destination: URL(string: "https://doi.org/10.1007/s13300-019-0581-y")!)
            Link(
              "Tirzepatide model · Schneck 2024",
              destination: URL(string: "https://doi.org/10.1002/psp4.13099")!)
          }
        }.navigationTitle("About this graph").navigationBarTitleDisplayMode(.inline).toolbar {
          ToolbarItem(placement: .confirmationAction) {
            Button("Done", systemImage: "checkmark") { info = false }
          }
        }
      }.tendrSheet(page: true)
    }
  }
  @ViewBuilder private func graph(_ plot: MedicationPlot) -> some View {
    let chart = Chart {
      ForEach(plot.history) { point in
        AreaMark(x: .value("Date", point.date), y: .value("Estimated mg", point.amount))
          .foregroundStyle(
            LinearGradient(
              colors: [Theme.pine.opacity(0.20), Theme.pine.opacity(0.01)], startPoint: .top,
              endPoint: .bottom))
        LineMark(
          x: .value("Date", point.date), y: .value("Estimated mg", point.amount),
          series: .value("Series", "History")
        ).foregroundStyle(Theme.pine).lineStyle(StrokeStyle(lineWidth: 2.5))
      }
      ForEach(plot.projection) { point in
        LineMark(
          x: .value("Date", point.date), y: .value("Estimated mg", point.amount),
          series: .value("Series", "Projection")
        ).foregroundStyle(Theme.pine.opacity(0.65)).lineStyle(
          StrokeStyle(lineWidth: 2, dash: [5, 4]))
      }
      ForEach(plot.planned) { dose in
        PointMark(
          x: .value("Date", dose.date), y: .value("Estimated mg", plot.amount(at: dose.date))
        )
        .foregroundStyle(Theme.pine.opacity(0.55)).symbolSize(28).symbol(.circle)
      }
      RuleMark(x: .value("Now", plot.now)).foregroundStyle(.secondary.opacity(0.4)).lineStyle(
        StrokeStyle(lineWidth: 1, dash: [3, 3]))
      PointMark(
        x: .value("Date", selected ?? plot.now),
        y: .value("Estimate", plot.amount(at: selected ?? plot.now))
      ).foregroundStyle(Theme.pine).symbolSize(55)
    }
    .chartXScale(domain: plot.start...plot.end)
    .chartXAxis {
      AxisMarks(values: .automatic(desiredCount: 4)) { _ in
        AxisValueLabel(format: .dateTime.month(.abbreviated).day())
      }
    }
    .chartYAxis {
      AxisMarks(position: .leading, values: .automatic(desiredCount: 3)) { _ in
        AxisGridLine().foregroundStyle(.gray.opacity(0.1))
        AxisValueLabel()
      }
    }
    .frame(
      height: expanded
        ? CGFloat(
          TendrLayout(
            horizontal: horizontalSizeClass.map(TendrLayout.SizeClass.init),
            vertical: verticalSizeClass.map(TendrLayout.SizeClass.init)
          ).medicationChartHeight) : 145
    )
    .accessibilityIdentifier(expanded ? "medicationDetailChart" : "medicationChart")
    .accessibilityLabel(
      "Estimated medication level. Solid line shows history; dashed line shows projection.")
    if expanded {
      chart.chartXSelection(
        value: Binding(get: { selected }, set: { if let date = $0 { selected = date } }))
    } else {
      chart
    }
  }
}
struct LevelSample: Identifiable {
  var id: Date { date }
  let date: Date
  let amount: Double
  let future: Bool
}

private struct MedicationPlot {
  let start: Date
  let end: Date
  let now: Date
  let doses: [DoseEntry]
  let history: [LevelSample]
  let projection: [LevelSample]
  let planned: [DoseEntry]
  let medication: String
  let halfLifeDays: Double
  let model: MedicationModel
  let referenceDose: Double

  init(journal: Journal, start: Date, now: Date, expanded: Bool) {
    let end = now.addingTimeInterval(14 * 86400)
    let doses = journal.doses + journal.scheduledProjection(from: now, through: end)
    let medication = journal.medication
    let halfLifeDays = journal.halfLifeDays
    let model = journal.resolvedMedicationModel
    let count = expanded ? 360 : 180
    let span = max(1, end.timeIntervalSince(start))
    let samples = (0...count).map { offset in
      let date = start.addingTimeInterval(span * Double(offset) / Double(count))
      let amount = MedicationLevel.remaining(
        at: date, doses: doses, medication: medication, halfLifeDays: halfLifeDays,
        includePlans: true, now: now, model: model)
      return LevelSample(date: date, amount: amount, future: date > now)
    }
    self.start = start
    self.end = end
    self.now = now
    self.doses = doses
    self.history = samples.filter { !$0.future }
    self.projection = samples.filter { $0.date >= now }
    self.planned = doses.filter { $0.status == .planned && $0.date > now && $0.date <= end }
    self.medication = medication
    self.halfLifeDays = halfLifeDays
    self.model = model
    self.referenceDose =
      journal.doses.filter {
        $0.medication.caseInsensitiveCompare(medication) == .orderedSame && $0.status == .taken
          && $0.date <= now
      }.map(\.milligrams).max() ?? 0
  }
  func amount(at date: Date) -> Double {
    MedicationLevel.remaining(
      at: date, doses: doses, medication: medication, halfLifeDays: halfLifeDays,
      includePlans: true, now: now, model: model)
  }
  func levelAndRate(at date: Date, referenceNow: Date) -> (Double, Double) {
    let eligible = doses.filter { $0.date <= date }
    let value = MedicationLevel.remaining(
      at: date, doses: eligible, medication: medication, halfLifeDays: halfLifeDays,
      includePlans: true, now: referenceNow, model: model)
    let next = MedicationLevel.remaining(
      at: date.addingTimeInterval(1), doses: eligible, medication: medication,
      halfLifeDays: halfLifeDays, includePlans: true, now: referenceNow, model: model)
    return (value, (next - value) * 3600)
  }
}

struct MedicationAnalytics: View {
  @Environment(Store.self) private var store
  @Environment(\.medicationVisit) private var medicationVisit
  @State private var days = 7
  @State private var now = Date()
  @State private var selected: Date?
  func amount(_ date: Date) -> Double {
    MedicationLevel.remaining(
      at: date, doses: store.journal.doses, medication: store.journal.medication,
      halfLifeDays: store.journal.halfLifeDays, now: now,
      model: store.journal.resolvedMedicationModel)
  }
  func rate(_ date: Date) -> Double {
    MedicationLevel.rate(
      at: date, doses: store.journal.doses, medication: store.journal.medication,
      halfLifeDays: store.journal.halfLifeDays, now: now,
      model: store.journal.resolvedMedicationModel)
  }
  var body: some View {
    let start = max(store.firstDoseDate ?? now, now.addingTimeInterval(-Double(days) * 86400))
    let span = max(0, now.timeIntervalSince(start))
    let dates = (span > 0 ? Array(0...240) : [0]).map {
      start.addingTimeInterval(span * Double($0) / 240)
    }
    let values = dates.map(amount)
    let average =
      span > 0
      ? zip(values, values.dropFirst()).reduce(0.0) { $0 + ($1.0 + $1.1) / 2 } / 240 : amount(now)
    let timestamp = selected ?? now
    VStack(alignment: .leading, spacing: 16) {
      FilterBar(selection: $days, options: [(1, "Day"), (7, "Week"), (30, "Month")])
      VStack(alignment: .leading, spacing: 16) {
        HStack {
          Text("Rate of change").font(.headline)
          Spacer()
          Text("mg/h").font(.caption).foregroundStyle(.secondary)
        }
        Chart {
          ForEach(dates, id: \.self) { date in
            LineMark(x: .value("Date", date), y: .value("mg/h", rate(date))).foregroundStyle(
              Theme.pine)
          }
          RuleMark(y: .value("Zero", 0)).foregroundStyle(.secondary.opacity(0.3))
          if let selected {
            RuleMark(x: .value("Selected", selected)).foregroundStyle(.secondary)
          }
        }.chartXSelection(value: $selected).frame(height: 170)
        HStack {
          value("Per minute", rate(timestamp) / 60, unit: "mg/min")
          Spacer()
          value("Per hour", rate(timestamp), unit: "mg/h")
        }
        if selected != nil {
          Text(timestamp, format: .dateTime.month(.abbreviated).day().hour().minute()).font(
            .caption
          ).foregroundStyle(.secondary)
        }
      }.card()
      HStack {
        value("Average level", average, unit: "mg")
        Spacer()
        value("Peak level", values.max() ?? 0, unit: "mg")
      }.frame(maxWidth: .infinity).card()
    }
    .onChange(of: days) { _, _ in selected = nil }
    .onChange(of: medicationVisit) { _, _ in selected = nil }
    .onAppear { now = Date() }
    .onReceive(Timer.publish(every: 60, on: .main, in: .common).autoconnect()) { now = $0 }
  }
  func value(_ title: String, _ amount: Double, unit: String) -> some View {
    VStack(alignment: .leading, spacing: 6) {
      Text(title).font(.caption).foregroundStyle(.secondary)
      Text(amount.formatted(.number.precision(.fractionLength(0...6)))).font(
        .title3.weight(.semibold)
      ).monospacedDigit().minimumScaleFactor(0.6).lineLimit(1)
      Text(unit).font(.caption).foregroundStyle(.secondary)
    }
  }
}
