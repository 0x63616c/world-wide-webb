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
                        CircleButton(symbol: "xmark", label: "Close Walk Zero", size: sizeClass == .compact ? 40 : 56, action: close)
                        Spacer()
                    }
                }.frame(height: sizeClass == .compact ? 64 : 80)
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
    private var compact: Bool { sizeClass == .compact }
    var body: some View {
        TimelineView(.periodic(from: .now, by: 1)) { _ in
            HStack(spacing: compact ? 16 : 24) {
                Button(action: open) {
                    VStack(alignment: .leading, spacing: 10) {
                        Label("Walk Zero", systemImage: "pawprint.fill")
                            .font(.system(size: compact ? 22 : 28, weight: .semibold))
                        if let walk = store.walks.activeWalk {
                            Text("Elapsed \(walkElapsed(walk.duration(at: store.now)))")
                                .font(.system(size: compact ? 22 : 32, weight: .medium, design: .rounded)).monospacedDigit()
                            Text("Started on \(walk.startedBy.rawValue)")
                                .font(.system(size: compact ? 15 : 24))
                        } else {
                            Text("\(store.walks.lastWalkLabel(at: store.now)) · \(Int(store.walks.history.first?.duration(at: store.now) ?? 0) / 60) min")
                                .font(.system(size: compact ? 16 : 24)).lineLimit(2).fixedSize(horizontal: false, vertical: true)
                        }
                        Text("History ›").font(.system(size: compact ? 16 : 20, weight: .medium))
                    }.frame(maxWidth: .infinity, alignment: .leading)
                }.buttonStyle(.plain).accessibilityLabel("Walk Zero history")
                VStack(spacing: 6) {
                    Button { store.toggleWalk() } label: {
                        Image(systemName: store.walks.activeWalk == nil ? "play.fill" : "stop.fill")
                            .font(.system(size: 24)).frame(width: 72, height: 72)
                            .glassEffect(.regular.tint(.green).interactive(), in: .circle)
                    }.buttonStyle(.plain)
                        .accessibilityLabel(store.walks.activeWalk == nil ? "Start walking Zero" : "Stop walking Zero")
                    Text(store.walks.activeWalk == nil ? "Start" : "End")
                        .font(.system(size: compact ? 15 : 20, weight: .medium))
                }
            }.padding(compact ? 24 : 32)
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
            VStack(alignment: .leading, spacing: compact ? 24 : 32) {
                let active = store.walks.activeWalk != nil
                let headerLayout = compact ? AnyLayout(VStackLayout(alignment: .leading, spacing: 16)) : AnyLayout(HStackLayout(alignment: .center, spacing: 32))
                headerLayout {
                    VStack(alignment: .leading, spacing: 8) {
                        if !compact && !active {
                            Label("Zero’s walks", systemImage: "pawprint.fill")
                                .font(.system(size: 48, weight: .bold))
                        }
                        TimelineView(.periodic(from: .now, by: 1)) { _ in
                            if let walk = store.walks.activeWalk {
                                VStack(alignment: .leading, spacing: 8) {
                                    Text("Elapsed").font(.system(size: 20, weight: .medium))
                                    Text(walkElapsed(walk.duration(at: store.now)))
                                        .font(.system(size: 64, weight: .medium, design: .rounded)).monospacedDigit()
                                        .accessibilityIdentifier("walk-elapsed")
                                    Text("Started on \(walk.startedBy.rawValue)")
                                        .font(.system(size: compact ? 18 : 24))
                                }
                            } else {
                                Text(store.walks.lastWalkLabel(at: store.now))
                                    .font(.system(size: compact ? 20 : 24))
                            }
                        }
                    }
                    if !compact { Spacer() }
                    Button(active ? "End walk" : "Start walk", systemImage: active ? "stop.fill" : "play.fill") { store.toggleWalk() }
                        .font(.system(size: compact ? 18 : 24, weight: .semibold))
                        .buttonStyle(.glassProminent).tint(.green).controlSize(.large)
                }
                if let reason = store.walkActivity.unavailableReason { Text(reason).font(.callout).foregroundStyle(.secondary) }
                let summary = store.walks.summary(at: store.now)
                HStack(spacing: compact ? 12 : 56) {
                    metric("This week", value: "\(summary.weeklyMinutes)", unit: "min")
                    metric("3-week average", value: "\(summary.averageMinutes)", unit: "min")
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
                            }.pickerStyle(.segmented).controlSize(.extraLarge)
                                .frame(width: compact ? 200 : 240, height: 48)
                        }
                        Text("Minutes per day").font(.system(size: compact ? 16 : 20)).foregroundStyle(.primary)
                        Chart(store.walks.days(range, ending: store.now)) { day in
                            BarMark(x: .value("Day", day.date, unit: .day), y: .value("Minutes", day.minutes))
                                .foregroundStyle(.green.gradient).cornerRadius(5)
                                .accessibilityLabel(fixtureTime(day.date, format: "EEEE, MMMM d"))
                                .accessibilityValue("\(Int(day.minutes)) minutes")
                        }
                        .chartXAxis {
                            AxisMarks(values: .stride(by: .day, count: range == 7 ? 1 : 5)) {
                                AxisValueLabel(format: range == 7 ? .dateTime.weekday(.abbreviated) : .dateTime.day(), centered: true)
                                    .font(.system(size: compact ? 14 : 18)).foregroundStyle(.primary)
                            }
                        }
                        .chartYAxis { AxisMarks(position: .leading, values: [0, 15, 30, 45, 60]) { AxisGridLine(); AxisValueLabel().font(.system(size: compact ? 14 : 18)).foregroundStyle(.primary) } }
                        .chartYScale(domain: 0...60)
                        .frame(height: compact ? 220 : active ? 264 : 320)
                    }.frame(maxWidth: .infinity).padding(compact ? 20 : 28)
                        .glassEffect(.regular, in: .rect(cornerRadius: 32))
                    VStack(alignment: .leading, spacing: 16) {
                        Text("Walk history").font(.system(size: compact ? 22 : 28, weight: .semibold))
                            .frame(height: compact ? 28 : 48, alignment: .leading)
                        ForEach(store.walks.history) { walk in
                            HStack {
                                VStack(alignment: .leading, spacing: 6) {
                                    Text(fixtureTime(walk.startedAt, format: "EEE, MMM d")).font(.system(size: 19, weight: .medium))
                                    Text(fixtureTime(walk.startedAt, format: "h:mm a")).font(.system(size: compact ? 17 : 20)).foregroundStyle(.primary)
                                }
                                Spacer()
                                Text("\(Int(walk.duration(at: store.now) / 60)) min").font(.system(size: 21, weight: .medium, design: .rounded)).monospacedDigit()
                            }.padding(.vertical, 10)
                            Divider()
                        }
                    }.padding(.top, compact ? 0 : 28).frame(width: compact ? nil : 320)
                }
            }.padding(compact ? 24 : 56).frame(maxWidth: 1280).frame(maxWidth: .infinity)
            }
        }.scrollEdgeEffectStyle(.soft, for: .all)
    }
    private func metric(_ title: String, value: String, unit: String) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title).font(.system(size: compact ? 14 : 20)).foregroundStyle(.primary)
            HStack(alignment: .firstTextBaseline, spacing: 5) {
                Text(value).font(.system(size: compact ? 34 : 56, weight: .medium, design: .rounded)).monospacedDigit()
                Text(unit).font(.system(size: compact ? 14 : 20)).foregroundStyle(.primary)
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
