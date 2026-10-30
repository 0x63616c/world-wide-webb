import SwiftUI
import Charts

/// The native bars reserve their own space and register scroll-edge effects.
/// Keeping them on the scrolling screen prevents chart content crossing the
/// fixture footer on compact displays.
struct DogWalkScreen: View {
    let store: any HomeDataSource
    let close: () -> Void
    @Environment(\.horizontalSizeClass) private var sizeClass
    var body: some View {
        DogWalkPage(store: store)
            .safeAreaBar(edge: .top, spacing: 0) {
                ZStack {
                    Text("Walk Zero").font(.system(size: sizeClass == .compact ? 20 : 25, weight: .semibold))
                    HStack {
                        CircleButton(symbol: "xmark", label: "Close Walk Zero", action: close)
                        Spacer()
                    }
                }.frame(height: 62)
                    .padding(.horizontal, sizeClass == .compact ? 24 : 38)
                    .padding(.top, sizeClass == .compact ? 8 : 30)
            }
            .safeAreaBar(edge: .bottom, spacing: 0) {
                Text("Fixture data").font(.system(size: 12)).foregroundStyle(.secondary)
                    .padding(.vertical, 12).frame(maxWidth: .infinity)
            }
    }
}

struct DogWalkTile: View {
    let store: any HomeDataSource
    let open: () -> Void
    @Environment(\.horizontalSizeClass) private var sizeClass
    var body: some View {
        TimelineView(.periodic(from: .now, by: 1)) { _ in
            HStack(spacing: 20) {
                Button(action: open) {
                    VStack(alignment: .leading, spacing: 12) {
                        Label("Walk Zero", systemImage: "pawprint.fill").font(.system(size: sizeClass == .compact ? 22 : 27, weight: .semibold))
                        if let walk = store.walks.activeWalk {
                            Text(walkElapsed(walk.duration(at: store.now))).font(.system(size: 36, weight: .medium, design: .rounded)).monospacedDigit()
                            Text("Started on \(walk.startedBy.rawValue)").font(.system(size: 16)).foregroundStyle(.secondary)
                        } else {
                            Text("\(store.walks.lastWalkLabel(at: store.now)) · \(Int(store.walks.history.first?.duration(at: store.now) ?? 0) / 60) min")
                                .font(.system(size: sizeClass == .compact ? 14 : 17)).foregroundStyle(.secondary).lineLimit(2)
                        }
                    }.frame(maxWidth: .infinity, alignment: .leading)
                }.buttonStyle(.plain)
                Button { store.toggleWalk() } label: {
                    Image(systemName: store.walks.activeWalk == nil ? "play.fill" : "stop.fill")
                        .font(.system(size: 22)).frame(width: 56, height: 56)
                }.buttonStyle(.glass).tint(.green)
                    .accessibilityLabel(store.walks.activeWalk == nil ? "Start walking Zero" : "Stop walking Zero")
            }.padding(sizeClass == .compact ? 24 : 32)
        }
    }
}
struct DogWalkPage: View {
    let store: any HomeDataSource
    @State private var range = 7
    @Environment(\.horizontalSizeClass) private var sizeClass
    private var compact: Bool { sizeClass == .compact }
    var body: some View {
        ScrollView {
            GlassEffectContainer(spacing: 24) {
            VStack(alignment: .leading, spacing: 32) {
                let headerLayout = compact ? AnyLayout(VStackLayout(alignment: .leading, spacing: 20)) : AnyLayout(HStackLayout(alignment: .center))
                headerLayout {
                    VStack(alignment: .leading, spacing: 10) {
                        Label("Zero’s walks", systemImage: "pawprint.fill").font(.system(size: compact ? 32 : 48, weight: .bold))
                        TimelineView(.periodic(from: .now, by: 1)) { _ in
                            if let walk = store.walks.activeWalk {
                                Text("Started on \(walk.startedBy.rawValue) · \(walkElapsed(walk.duration(at: store.now)))").monospacedDigit()
                            } else { Text(store.walks.lastWalkLabel(at: store.now)) }
                        }.font(.system(size: compact ? 18 : 23)).foregroundStyle(.secondary)
                    }
                    if !compact { Spacer() }
                    Button(store.walks.activeWalk == nil ? "Start walk" : "End walk", systemImage: store.walks.activeWalk == nil ? "play.fill" : "stop.fill") { store.toggleWalk() }
                        .font(.system(size: compact ? 17 : 21, weight: .semibold)).buttonStyle(.glassProminent).tint(.green).controlSize(.large)
                }
                if let reason = store.walkActivity.unavailableReason { Text(reason).font(.callout).foregroundStyle(.secondary) }
                let summary = store.walks.summary(at: store.now)
                HStack(spacing: compact ? 12 : 56) {
                    metric("This week", value: "\(summary.weeklyMinutes)", unit: "min")
                    metric("Average walk", value: "\(summary.averageMinutes)", unit: "min")
                    metric("Streak", value: "\(summary.streak)", unit: "days")
                }.padding(.vertical, 8)
                let layout = compact ? AnyLayout(VStackLayout(alignment: .leading, spacing: 32)) : AnyLayout(HStackLayout(alignment: .top, spacing: 48))
                layout {
                    VStack(alignment: .leading, spacing: 24) {
                        let chartHeader = compact ? AnyLayout(VStackLayout(alignment: .leading, spacing: 16)) : AnyLayout(HStackLayout())
                        chartHeader {
                            Text("Time outdoors").font(.system(size: compact ? 22 : 28, weight: .semibold))
                            if !compact { Spacer() }
                            Picker("Chart period", selection: $range) {
                                Text("7 days").tag(7)
                                Text("30 days").tag(30)
                            }.pickerStyle(.segmented).frame(width: compact ? 148 : 200)
                        }
                        Text("Minutes per day").font(.system(size: 16)).foregroundStyle(.secondary)
                        Chart(store.walks.days(range, ending: store.now)) { day in
                            BarMark(x: .value("Day", day.date, unit: .day), y: .value("Minutes", day.minutes))
                                .foregroundStyle(.green.gradient).cornerRadius(5)
                                .accessibilityLabel(fixtureTime(day.date, format: "EEEE, MMMM d"))
                                .accessibilityValue("\(Int(day.minutes)) minutes")
                        }
                        .chartXAxis {
                            AxisMarks(values: .stride(by: .day, count: range == 7 ? 1 : 5)) {
                                AxisValueLabel(format: range == 7 ? .dateTime.weekday(.abbreviated) : .dateTime.day(), centered: true)
                            }
                        }
                        .chartYAxis { AxisMarks(position: .leading, values: [0, 15, 30, 45, 60]) { AxisGridLine(); AxisValueLabel() } }
                        .chartYScale(domain: 0...60)
                        .frame(height: compact ? 220 : 320)
                    }.frame(maxWidth: .infinity).padding(compact ? 20 : 28)
                        .glassEffect(.regular, in: .rect(cornerRadius: 32))
                    VStack(alignment: .leading, spacing: 16) {
                        Text("Walk history").font(.system(size: compact ? 22 : 28, weight: .semibold))
                        ForEach(store.walks.history) { walk in
                            HStack {
                                VStack(alignment: .leading, spacing: 6) {
                                    Text(fixtureTime(walk.startedAt, format: "EEE, MMM d")).font(.system(size: 19, weight: .medium))
                                    Text(fixtureTime(walk.startedAt, format: "h:mm a")).font(.system(size: 15)).foregroundStyle(.secondary)
                                }
                                Spacer()
                                Text("\(Int(walk.duration(at: store.now) / 60)) min").font(.system(size: 21, weight: .medium, design: .rounded)).monospacedDigit()
                            }.padding(.vertical, 10)
                            Divider()
                        }
                    }.frame(width: compact ? nil : 320)
                }
            }.padding(compact ? 24 : 56).frame(maxWidth: 1280).frame(maxWidth: .infinity)
            }
        }.scrollEdgeEffectStyle(.soft, for: .all)
    }
    private func metric(_ title: String, value: String, unit: String) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title).font(.system(size: compact ? 14 : 18)).foregroundStyle(.secondary)
            HStack(alignment: .firstTextBaseline, spacing: 5) {
                Text(value).font(.system(size: compact ? 34 : 56, weight: .medium, design: .rounded)).monospacedDigit()
                Text(unit).font(.system(size: compact ? 14 : 20)).foregroundStyle(.secondary)
            }
        }.frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// Fallback evidence uses the extension's exact content view, never a claim of
/// having captured SpringBoard. The label remains in the simulator screenshot.
struct WalkActivityPreviewPage: View {
    var body: some View {
        ZStack {
            Wallpaper()
            VStack(alignment: .leading, spacing: 28) {
                Text("Live Activity preview").font(.largeTitle.bold())
                Text("Walking Zero · Fixture data").font(.subheadline).foregroundStyle(.secondary)
                Text("Lock Screen").font(.headline)
                WalkActivityContent(name: "Zero", startedAt: .now, previewElapsed: "12:34")
                    .glassEffect(.regular, in: .rect(cornerRadius: 28))
                Text("Dynamic Island · Expanded").font(.headline)
                VStack(spacing: 18) {
                    HStack {
                        Label("Walking Zero", systemImage: "pawprint.fill")
                        Spacer()
                        Text("12:34").monospacedDigit()
                    }.font(.headline).foregroundStyle(.green)
                    Text("Walk in progress").font(.subheadline).foregroundStyle(.secondary)
                }.padding(24).background(.black, in: .rect(cornerRadius: 44))
                Text("Compact / Minimal").font(.headline)
                HStack(spacing: 24) {
                    HStack { Image(systemName: "pawprint.fill"); Spacer(); Text("12:34").monospacedDigit() }
                        .foregroundStyle(.green).padding(.horizontal, 14).frame(width: 230, height: 37).background(.black, in: .capsule)
                    Image(systemName: "pawprint.fill").foregroundStyle(.green).frame(width: 37, height: 37).background(.black, in: .circle)
                }
                Spacer()
                Text("Shared WidgetKit content · Simulator preview").font(.footnote).foregroundStyle(.secondary)
            }.padding(24).padding(.top, 24)
        }.preferredColorScheme(.dark)
    }
}
