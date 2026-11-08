import AppIntents
import FoldingData
import SwiftUI
import WidgetKit

// Separate kinds constrain choices to the supported family without misleading fallback labels.
enum TrackingMetric: String, AppEnum {
  case folds, unfolded, limit, trend
  static let typeDisplayRepresentation = TypeDisplayRepresentation(
    name: LocalizedStringResource("widget.metric", defaultValue: "Metric"))
  static let caseDisplayRepresentations: [Self: DisplayRepresentation] = [
    .folds: DisplayRepresentation(
      title: LocalizedStringResource("metric.folds", defaultValue: "Folds")),
    .unfolded: DisplayRepresentation(
      title: LocalizedStringResource("metric.timeUnfolded", defaultValue: "Time unfolded")),
    .limit: DisplayRepresentation(
      title: LocalizedStringResource("settings.dailyLimit", defaultValue: "Daily limit")),
    .trend: DisplayRepresentation(
      title: LocalizedStringResource("metric.trend", defaultValue: "Last 7 days")),
  ]
}
enum CompactMetric: String, AppEnum {
  case folds, unfolded, limit
  static let typeDisplayRepresentation = TypeDisplayRepresentation(
    name: LocalizedStringResource("widget.metric", defaultValue: "Metric"))
  static let caseDisplayRepresentations: [Self: DisplayRepresentation] = [
    .folds: DisplayRepresentation(
      title: LocalizedStringResource("metric.folds", defaultValue: "Folds")),
    .unfolded: DisplayRepresentation(
      title: LocalizedStringResource("metric.timeUnfolded", defaultValue: "Time unfolded")),
    .limit: DisplayRepresentation(
      title: LocalizedStringResource("settings.dailyLimit", defaultValue: "Daily limit")),
  ]
}
enum CircularMetric: String, AppEnum {
  case folds, limit
  static let typeDisplayRepresentation = TypeDisplayRepresentation(
    name: LocalizedStringResource("widget.metric", defaultValue: "Metric"))
  static let caseDisplayRepresentations: [Self: DisplayRepresentation] = [
    .folds: DisplayRepresentation(
      title: LocalizedStringResource("metric.folds", defaultValue: "Folds")),
    .limit: DisplayRepresentation(
      title: LocalizedStringResource("settings.dailyLimit", defaultValue: "Daily limit")),
  ]
}
protocol TrackingConfiguration: WidgetConfigurationIntent {
  var selectedMetric: TrackingMetric { get }
}
struct SmallConfiguration: TrackingConfiguration {
  static let title = LocalizedStringResource("widget.title", defaultValue: "Folding")
  @Parameter(
    title: LocalizedStringResource("widget.metric", defaultValue: "Metric"), default: .folds)
  var metric: CompactMetric
  var selectedMetric: TrackingMetric { TrackingMetric(rawValue: metric.rawValue) ?? .folds }
}
struct MediumConfiguration: TrackingConfiguration {
  static let title = LocalizedStringResource("widget.title", defaultValue: "Folding")
  @Parameter(
    title: LocalizedStringResource("widget.metric", defaultValue: "Metric"), default: .folds)
  var metric: TrackingMetric
  var selectedMetric: TrackingMetric { metric }
}
struct RectangularConfiguration: TrackingConfiguration {
  static let title = LocalizedStringResource("widget.title", defaultValue: "Folding")
  @Parameter(
    title: LocalizedStringResource("widget.metric", defaultValue: "Metric"), default: .folds)
  var metric: CompactMetric
  var selectedMetric: TrackingMetric { TrackingMetric(rawValue: metric.rawValue) ?? .folds }
}
struct CircularConfiguration: TrackingConfiguration {
  static let title = LocalizedStringResource("widget.title", defaultValue: "Folding")
  @Parameter(
    title: LocalizedStringResource("widget.metric", defaultValue: "Metric"), default: .folds)
  var metric: CircularMetric
  var selectedMetric: TrackingMetric { TrackingMetric(rawValue: metric.rawValue) ?? .folds }
}
struct TrackingEntry: TimelineEntry {
  let date: Date
  let metric: TrackingMetric
  let snapshot: WidgetTrackingSnapshot?
}
struct TrackingProvider<Configuration: TrackingConfiguration>: AppIntentTimelineProvider {
  func placeholder(in context: Context) -> TrackingEntry {
    // Gallery-only fixture. Runtime reads never fall back to this data.
    TrackingEntry(
      date: .now, metric: .folds,
      snapshot: WidgetTrackingSnapshot(
        routeID: UUID(uuidString: "00000000-0000-0000-0000-000000000001")!,
        generationRevision: 0,
        generationID: UUID(uuidString: "00000000-0000-0000-0000-000000000000")!,
        generatedAtMS: 0, homeDayEndMS: 86_400_000, folds: 42, unfoldedMS: 3_600_000,
        dailyLimit: 100, trend: [20, 34, 29, 50, 46, 32, 42], accent: "blue", setupComplete: true))
  }
  func snapshot(for configuration: Configuration, in context: Context) async -> TrackingEntry {
    entry(configuration)
  }
  func timeline(for configuration: Configuration, in context: Context) async -> Timeline<
    TrackingEntry
  > {
    let current = entry(configuration)
    let fallback = Date.now.addingTimeInterval(900)
    guard let snapshot = current.snapshot else {
      return Timeline(entries: [current], policy: .after(fallback))
    }
    let end = Date(timeIntervalSince1970: Double(snapshot.homeDayEndMS) / 1000)
    // Never show yesterday's totals under today's label after midnight.
    let expired = TrackingEntry(date: end, metric: configuration.selectedMetric, snapshot: nil)
    return Timeline(entries: [current, expired], policy: .after(min(end, fallback)))
  }
  private func entry(_ configuration: Configuration) -> TrackingEntry {
    let now = Date.now
    let group = Bundle.main.object(forInfoDictionaryKey: "FoldingAppGroupIdentifier") as? String
    let snapshot = group.flatMap { try? WidgetSnapshotStore(groupIdentifier: $0).read() }
    let valid = snapshot.flatMap {
      $0.generatedAtMS <= Int64(now.timeIntervalSince1970 * 1000)
        && $0.homeDayEndMS > Int64(now.timeIntervalSince1970 * 1000) ? $0 : nil
    }
    return TrackingEntry(date: now, metric: configuration.selectedMetric, snapshot: valid)
  }
}

struct TrackingWidgetView: View {
  let entry: TrackingEntry
  @Environment(\.widgetFamily) private var family
  @Environment(\.colorScheme) private var colorScheme
  @Environment(\.widgetRenderingMode) private var renderingMode
  var body: some View {
    Group {
      if let snapshot = entry.snapshot, snapshot.setupComplete {
        content(snapshot)
      } else {
        Label(
          String(localized: "widget.open", defaultValue: "Open Folding"), systemImage: "iphone.gen3"
        )
        .font(.caption)
      }
    }
    .containerBackground(.background, for: .widget)
    .widgetURL(URL(string: entry.metric == .trend ? "folding://history" : "folding://today"))
  }
  @ViewBuilder private func content(_ snapshot: WidgetTrackingSnapshot) -> some View {
    if family == .accessoryCircular {
      if entry.metric == .limit {
        Gauge(value: min(Double(snapshot.folds) / Double(snapshot.dailyLimit), 1)) {
          Image(systemName: "iphone.gen3")
        } currentValueLabel: {
          Text(snapshot.folds, format: .number).minimumScaleFactor(0.5)
        }
        .gaugeStyle(.accessoryCircular)
        .accessibilityLabel(label)
        .accessibilityValue(snapshot.folds.formatted())
      } else {
        VStack(spacing: 2) {
          Image(systemName: "iphone.gen3")
          Text(snapshot.folds, format: .number).font(.headline).minimumScaleFactor(0.5)
        }.accessibilityElement(children: .combine).accessibilityLabel(label)
          .accessibilityValue(snapshot.folds.formatted())
      }
    } else {
      VStack(alignment: .leading, spacing: 6) {
        if entry.metric == .trend {
          HStack(alignment: .bottom, spacing: 5) {
            ForEach(Array(snapshot.trend.enumerated()), id: \.offset) { _, count in
              RoundedRectangle(cornerRadius: 3)
                .fill(accent(snapshot))
                .frame(
                  height: max(2, 65 * Double(count) / Double(max(snapshot.trend.max() ?? 1, 1))))
            }
          }.accessibilityElement(children: .ignore)
            .accessibilityLabel(label)
            .accessibilityValue(snapshot.trend.map { $0.formatted() }.joined(separator: ", "))
        } else if entry.metric == .unfolded {
          Text(
            Duration.milliseconds(snapshot.unfoldedMS),
            format: .units(allowed: [.hours, .minutes], width: .abbreviated)
          )
          .font(family == .accessoryRectangular ? .headline : .title.bold())
          .minimumScaleFactor(0.7)
        } else {
          Text(snapshot.folds, format: .number)
            .font(family == .accessoryRectangular ? .headline : .largeTitle.bold())
            .monospacedDigit().minimumScaleFactor(0.7)
          if entry.metric == .limit {
            ProgressView(value: min(Double(snapshot.folds) / Double(snapshot.dailyLimit), 1))
              .tint(accent(snapshot))
          }
        }
        Text(label).font(.caption).foregroundStyle(.secondary)
      }.frame(maxWidth: .infinity, alignment: .leading)
    }
  }
  private var label: String {
    switch entry.metric {
    case .folds: String(localized: "metric.folds", defaultValue: "Folds")
    case .unfolded: String(localized: "metric.timeUnfolded", defaultValue: "Time unfolded")
    case .limit: String(localized: "settings.dailyLimit", defaultValue: "Daily limit")
    case .trend: String(localized: "metric.trend", defaultValue: "Last 7 days")
    }
  }
  private func accent(_ snapshot: WidgetTrackingSnapshot) -> Color {
    guard renderingMode == .fullColor else { return .primary }
    return colorScheme == .dark ? .white : .black
  }
}

struct SmallTrackingWidget: Widget {
  var body: some WidgetConfiguration {
    AppIntentConfiguration(
      kind: "FoldingSmall", intent: SmallConfiguration.self,
      provider: TrackingProvider<SmallConfiguration>()
    ) { TrackingWidgetView(entry: $0) }
    .configurationDisplayName(String(localized: "widget.title", defaultValue: "Folding"))
    .supportedFamilies([.systemSmall])
  }
}
struct MediumTrackingWidget: Widget {
  var body: some WidgetConfiguration {
    AppIntentConfiguration(
      kind: "FoldingMedium", intent: MediumConfiguration.self,
      provider: TrackingProvider<MediumConfiguration>()
    ) { TrackingWidgetView(entry: $0) }
    .configurationDisplayName(String(localized: "widget.title", defaultValue: "Folding"))
    .supportedFamilies([.systemMedium])
  }
}
struct RectangularTrackingWidget: Widget {
  var body: some WidgetConfiguration {
    AppIntentConfiguration(
      kind: "FoldingRectangular", intent: RectangularConfiguration.self,
      provider: TrackingProvider<RectangularConfiguration>()
    ) { TrackingWidgetView(entry: $0) }
    .configurationDisplayName(String(localized: "widget.title", defaultValue: "Folding"))
    .supportedFamilies([.accessoryRectangular])
  }
}
struct CircularTrackingWidget: Widget {
  var body: some WidgetConfiguration {
    AppIntentConfiguration(
      kind: "FoldingCircular", intent: CircularConfiguration.self,
      provider: TrackingProvider<CircularConfiguration>()
    ) { TrackingWidgetView(entry: $0) }
    .configurationDisplayName(String(localized: "widget.title", defaultValue: "Folding"))
    .supportedFamilies([.accessoryCircular])
  }
}
@main struct FoldingWidgetBundle: WidgetBundle {
  var body: some Widget {
    SmallTrackingWidget()
    MediumTrackingWidget()
    RectangularTrackingWidget()
    CircularTrackingWidget()
  }
}
