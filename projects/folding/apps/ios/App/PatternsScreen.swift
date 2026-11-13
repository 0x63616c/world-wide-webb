import Charts
import FoldingDomain
import SwiftUI

struct PatternsScreen: View {
  @Bindable var model: FoldingPresentation
  let actions: FoldingActions
  @Environment(\.locale) private var locale
  @State private var patterns: FoldingActivityPatterns?
  @State private var period = PatternPeriod.hour
  @State private var failed = false
  @State private var selected: Int?
  private enum PatternPeriod: String, CaseIterable, Identifiable {
    case hour, weekday, monthDay
    var id: Self { self }
    var title: String {
      switch self {
      case .hour: String(localized: "patterns.hour", defaultValue: "Time of day")
      case .weekday: String(localized: "patterns.weekday", defaultValue: "Day of week")
      case .monthDay: String(localized: "patterns.monthDay", defaultValue: "Day of month")
      }
    }
  }
  var body: some View {
    NavigationStack {
      ScrollView {
        VStack(alignment: .leading, spacing: 24) {
          Picker(String(localized: "patterns.title", defaultValue: "Patterns"), selection: $period)
          {
            ForEach(PatternPeriod.allCases) { Text($0.title).tag($0) }
          }.pickerStyle(.menu)
          if let patterns {
            let values = values(patterns)
            Chart(Array(values.indices), id: \.self) { index in
              BarMark(
                x: .value(period.title, index),
                y: .value(String(localized: "metric.folds", defaultValue: "Folds"), values[index])
              )
              .foregroundStyle(FoldingTint.color)
              .cornerRadius(5)
              .accessibilityLabel(label(index))
              .accessibilityValue(values[index].formatted())
            }
            .chartXAxis {
              AxisMarks(
                preset: .aligned,
                values: Array(
                  stride(
                    from: 0, to: values.count,
                    by: period == .hour ? 6 : max(1, Int(ceil(Double(values.count) / 7)))))
              ) { axis in
                AxisValueLabel(centered: false, anchor: .top, offsetsMarks: false) {
                  if let index = axis.as(Int.self), values.indices.contains(index) {
                    Text(label(index))
                  }
                }
              }
            }
            .chartXScale(domain: -0.5...(Double(values.count) - 0.5))
            .chartXSelection(value: $selected)
            .frame(height: 240)
            if let index = selected, values.indices.contains(index) {
              LabeledContent(label(index), value: values[index].formatted())
            }
            LabeledContent(
              String(localized: "history.all", defaultValue: "All"),
              value: values.reduce(0, +).formatted())
          } else if failed {
            Button(String(localized: "action.retry", defaultValue: "Retry")) {
              Task { await load() }
            }
          } else {
            ProgressView()
          }
        }.padding(20)
      }
      .navigationTitle(String(localized: "patterns.title", defaultValue: "Patterns"))
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .confirmationAction) {
          Button(String(localized: "action.done", defaultValue: "Done")) { model.sheet = nil }
        }
      }
      .task { await load() }
      .refreshable { await load() }
      .onChange(of: period) { _, _ in selected = nil }
    }
  }
  private func values(_ patterns: FoldingActivityPatterns) -> [Int] {
    switch period {
    case .hour: patterns.hours
    case .weekday: patterns.weekdays
    case .monthDay: patterns.monthDays
    }
  }
  private func label(_ index: Int) -> String {
    switch period {
    case .hour:
      let formatter = DateFormatter()
      formatter.locale = locale
      formatter.timeZone = TimeZone(secondsFromGMT: 0)
      formatter.dateFormat = DateFormatter.dateFormat(fromTemplate: "j", options: 0, locale: locale)
      return formatter.string(from: Date(timeIntervalSince1970: Double(index) * 3600))
    case .weekday:
      var calendar = Calendar(identifier: .gregorian)
      calendar.locale = locale
      return calendar.shortWeekdaySymbols[(index + 1) % 7]
    case .monthDay: return (index + 1).formatted(.number.locale(locale))
    }
  }
  private func load() async {
    guard let load = actions.loadPatterns else {
      failed = true
      return
    }
    do {
      patterns = try await load()
      failed = false
    } catch { failed = true }
  }
}
