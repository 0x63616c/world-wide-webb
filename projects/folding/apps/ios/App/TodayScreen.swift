import Charts
import FoldingData
import FoldingDomain
import SwiftUI

struct TodayScreen: View {
  @Environment(\.dynamicTypeSize) private var dynamicTypeSize
  @Bindable var model: FoldingPresentation
  let actions: FoldingActions
  private var today: PersonalDailySummary? {
    guard let snapshot = model.analytics else { return nil }
    return snapshot.days.first { $0.startMS <= snapshot.asOfMS && snapshot.asOfMS < $0.endMS }
  }

  var body: some View {
    GeometryReader { geometry in
      ScrollView {
        VStack(alignment: .leading, spacing: 16) {
          if let failure = model.personalFailure, model.analytics != nil {
            Label(failure, systemImage: "exclamationmark.circle").font(.subheadline)
              .foregroundStyle(
                .secondary)
          } else if model.needsSetup && model.personalFailure == nil {
            Button {
              model.present(.setup)
            } label: {
              Label(
                String(localized: "setup.start", defaultValue: "Set up tracking"),
                systemImage: "iphone"
              )
              .frame(maxWidth: .infinity, alignment: .leading)
              .padding(.vertical, 8)
            }
          } else if model.privateHistoryHealth?.requiresAttention == true {
            Button {
              model.selectedTab = .settings
            } label: {
              Label(
                String(localized: "recovery.title", defaultValue: "History needs attention"),
                systemImage: "exclamationmark.triangle"
              )
              .frame(maxWidth: .infinity, alignment: .leading).padding(.vertical, 8)
            }
          } else if model.analytics?.needsDeviceSelection == true {
            Button {
              model.present(.trackingPhone)
            } label: {
              Label(
                String(localized: "phone.choose", defaultValue: "Choose tracking phone"),
                systemImage: "iphone.gen3"
              )
              .frame(maxWidth: .infinity, alignment: .leading).padding(.vertical, 8)
            }
          } else if let value = model.syncStatus, value.publicTracking && value.resetPending {
            Label(
              String(localized: "sync.resetPending", defaultValue: "Reset pending"),
              systemImage: "arrow.triangle.2.circlepath"
            )
            .font(.subheadline).foregroundStyle(.secondary)
            .frame(maxWidth: .infinity, alignment: .leading).padding(.vertical, 8)
          } else if let status = model.status {
            Label(status, systemImage: "arrow.triangle.2.circlepath").font(.subheadline)
              .foregroundStyle(.secondary)
          }
          if let today, let snapshot = model.analytics {
            if SummaryCardLayout.usesWideRows(
              width: geometry.size.width, accessibilitySize: dynamicTypeSize.isAccessibilitySize)
            {
              HStack(alignment: .top, spacing: 12) {
                SummaryCard { trendChart(snapshot, height: 288) }
                  .frame(maxWidth: .infinity)
                metricsGrid(snapshot: snapshot, today: today)
                  .frame(maxWidth: .infinity)
              }
            } else {
              SummaryCard { trendChart(snapshot, height: 180) }
              metricsGrid(snapshot: snapshot, today: today)
            }
          } else if model.personalFailure != nil {
            ContentUnavailableView(
              String(localized: "tracking.unavailable", defaultValue: "Tracking unavailable"),
              systemImage: "exclamationmark.icloud")
          } else {
            ProgressView().frame(maxWidth: .infinity).padding(.vertical, 48)
          }
        }
        .frame(maxWidth: 1100, alignment: .leading)
        .padding(16)
        .frame(maxWidth: .infinity)
      }
    }
    .background(FoldingSurface.background)

  }

  private func metricsGrid(
    snapshot: PersonalAnalyticsSnapshot, today: PersonalDailySummary
  ) -> some View {
    LazyVGrid(
      columns: dynamicTypeSize.isAccessibilitySize
        ? [GridItem(.flexible())] : [GridItem(.flexible()), GridItem(.flexible())],
      spacing: 12
    ) {
      SummaryCard {
        MetricRow(
          title: String(localized: "metric.lifetimeFolds", defaultValue: "All-time folds"),
          value: snapshot.lifetime.folds.formatted())
      }
      SummaryCard {
        TimelineView(.periodic(from: .now, by: 1)) { context in
          let running = RunningDurationPresentation(snapshot: snapshot, day: today)
          let duration = snapshot.lifetime.completeDurationMS + running.durationMS(at: context.date)
          MetricRow(
            title: String(localized: "metric.timeUnfolded", defaultValue: "Time unfolded"),
            value: foldingElapsedDuration(duration))
        }
      }
      SummaryCard {
        MetricRow(
          title: String(localized: "metric.opens", defaultValue: "Opens"),
          value: snapshot.lifetime.opens.formatted())
      }
      SummaryCard {
        MetricRow(
          title: String(localized: "metric.closes", defaultValue: "Closes"),
          value: snapshot.lifetime.closes.formatted())
      }
      SummaryCard {
        MetricRow(
          title: String(localized: "metric.cycles", defaultValue: "Cycles"),
          value: snapshot.lifetime.cycles.formatted())
      }
      SummaryCard {
        MetricRow(
          title: String(localized: "tab.today", defaultValue: "Today"),
          value: today.folds.formatted())
      }
    }
  }

  private func trendChart(_ snapshot: PersonalAnalyticsSnapshot, height: CGFloat) -> some View {
    VStack(alignment: .leading, spacing: 12) {
      Text(String(localized: "metric.trend", defaultValue: "Last 7 days")).font(.headline)
      Chart(0..<snapshot.days.count, id: \.self) { index in
        let day = snapshot.days[index]
        BarMark(
          x: .value(String(localized: "chart.date", defaultValue: "Date"), index),
          y: .value(String(localized: "metric.folds", defaultValue: "Folds"), day.folds),
          width: .fixed(20)
        )
        .foregroundStyle(
          index == snapshot.days.count - 1
            ? FoldingTint.color : FoldingTint.color.opacity(0.55)
        )
        .cornerRadius(5)
        .accessibilityLabel(day.date)
        .accessibilityValue(day.folds.formatted())
      }
      .chartXAxis {
        AxisMarks(preset: .aligned, values: Array(snapshot.days.indices)) { value in
          AxisValueLabel(centered: false, anchor: .top, offsetsMarks: false) {
            if let index = value.as(Int.self), snapshot.days.indices.contains(index) {
              Text(
                Date(timeIntervalSince1970: Double(snapshot.days[index].startMS) / 1000),
                format: .dateTime.weekday(.abbreviated))
            }
          }
        }
      }
      .chartYAxis(.hidden)
      .chartXScale(domain: -0.5...(Double(snapshot.days.count) - 0.5))
      .frame(height: height)
      .accessibilityLabel(String(localized: "metric.trend", defaultValue: "Last 7 days"))
    }
  }

}
