import ActivityKit
import SwiftUI
import WidgetKit

@main
struct PanelAlarmWidgets: WidgetBundle {
  var body: some Widget { NextAlarmWidget() }
}

struct NextAlarmWidget: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: NextAlarmAttributes.self) { context in
      HStack(spacing: 18) {
        Image(systemName: "alarm.fill").font(.largeTitle).foregroundStyle(.orange)
        VStack(alignment: .leading, spacing: 6) {
          Text(context.state.label).font(.headline).lineLimit(1)
          Text(context.state.fireAt, style: .time).foregroundStyle(.secondary)
          if context.isStale { Text("Open Control Center to refresh").font(.caption) }
        }
        Spacer()
        countdown(context).font(.title2.monospacedDigit()).frame(maxWidth: 140)
      }.padding(20).activityBackgroundTint(Color(red: 0.06, green: 0.08, blue: 0.10))
        .activitySystemActionForegroundColor(.white)
        .widgetURL(URL(string: "controlcenter://alarms"))
    } dynamicIsland: { context in
      DynamicIsland {
        DynamicIslandExpandedRegion(.leading) {
          Label("Next alarm", systemImage: "alarm.fill").foregroundStyle(.orange)
        }
        DynamicIslandExpandedRegion(.trailing) { Text(context.state.fireAt, style: .time) }
        DynamicIslandExpandedRegion(.bottom) {
          VStack(spacing: 8) {
            Text(context.state.label).lineLimit(1)
            countdown(context).font(.largeTitle.monospacedDigit())
          }.padding(.bottom, 8)
        }
      } compactLeading: {
        Image(systemName: "alarm.fill").foregroundStyle(.orange)
      } compactTrailing: {
        countdown(context).monospacedDigit().frame(maxWidth: 72)
      } minimal: {
        Image(systemName: "alarm.fill").foregroundStyle(.orange)
      }.widgetURL(URL(string: "controlcenter://alarms"))
    }
  }

  @ViewBuilder private func countdown(_ context: ActivityViewContext<NextAlarmAttributes>) -> some View {
    if context.isStale { Text("Due") }
    else { Text(timerInterval: context.state.updatedAt...context.state.fireAt, countsDown: true).multilineTextAlignment(.trailing) }
  }
}
