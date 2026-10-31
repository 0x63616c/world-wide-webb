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
            .background { Color.black.ignoresSafeArea() }
    }
}

struct DogWalkTile: View {
    let store: any HomeDataSource
    let open: () -> Void
    @Environment(\.horizontalSizeClass) private var sizeClass
    private var compact: Bool { sizeClass == .compact }
    var body: some View {
        if compact { compactTile }
        else { panelTile }
    }
    private var panelTile: some View {
        TimelineView(.periodic(from: store.now, by: 1)) { _ in
            VStack(spacing: 24) {
                Button(action: open) {
                    VStack(spacing: 20) {
                        Image(systemName: "pawprint.fill")
                            .font(.system(size: 44)).foregroundStyle(.green)
                        Text("Walk Zero").font(.system(size: 28, weight: .semibold))
                        if let walk = store.walks.activeWalk {
                            VStack(spacing: 8) {
                                Text("Walking").font(.system(size: 20, weight: .medium))
                                Text(walkElapsed(walk.duration(at: store.now)))
                                    .font(.system(size: 44, weight: .medium, design: .rounded)).monospacedDigit()
                                    .lineLimit(1).minimumScaleFactor(0.7)
                                Text("Started on\n\(walk.startedBy.rawValue)")
                                    .font(.system(size: 20))
                            }
                        } else {
                            VStack(spacing: 8) {
                                if let last = store.walks.history.first {
                                    HStack(alignment: .firstTextBaseline, spacing: 6) {
                                        Text("\(Int(last.duration(at: store.now)) / 60)")
                                            .font(.system(size: 52, weight: .medium, design: .rounded)).monospacedDigit()
                                        Text("min").font(.system(size: 22))
                                    }
                                }
                                Text(store.walks.lastWalkLabel(at: store.now))
                                    .font(.system(size: 20)).fixedSize(horizontal: false, vertical: true)
                            }
                        }
                        Text("History ›").font(.system(size: 20, weight: .medium))
                    }.frame(maxWidth: .infinity, maxHeight: .infinity)
                        .multilineTextAlignment(.center).contentShape(.rect)
                }.buttonStyle(.plain).accessibilityLabel("Walk Zero history")
                Button { store.toggleWalk() } label: {
                    Label(store.walks.activeWalk == nil ? "Start" : "End", systemImage: store.walks.activeWalk == nil ? "play.fill" : "stop.fill")
                        .font(.system(size: 22, weight: .semibold)).foregroundStyle(.black)
                        .frame(maxWidth: .infinity).frame(height: 64)
                        .glassEffect(.regular.tint(.green).interactive(), in: .capsule)
                }.buttonStyle(.plain)
                    .accessibilityLabel(store.walks.activeWalk == nil ? "Start walking Zero" : "Stop walking Zero")
            }.padding(24)
        }
    }
    private var compactTile: some View {
        TimelineView(.periodic(from: store.now, by: 1)) { _ in
            HStack(spacing: compact ? 16 : 24) {
                Button(action: open) {
                    VStack(alignment: .leading, spacing: 0) {
                        Label("Walk Zero", systemImage: "pawprint.fill")
                            .font(.system(size: compact ? 22 : 32, weight: .semibold))
                        Spacer(minLength: 8)
                        if let walk = store.walks.activeWalk {
                            HStack(alignment: .firstTextBaseline, spacing: 12) {
                                Text("Elapsed").font(.system(size: compact ? 16 : 20, weight: .medium))
                                Text(walkElapsed(walk.duration(at: store.now)))
                                    .font(.system(size: compact ? 26 : 40, weight: .medium, design: .rounded)).monospacedDigit()
                            }
                            Text("Started on \(walk.startedBy.rawValue)")
                                .font(.system(size: compact ? 15 : 20)).foregroundStyle(.primary)
                                .padding(.top, 4)
                        } else {
                            Text("\(store.walks.lastWalkLabel(at: store.now)) · \(Int(store.walks.history.first?.duration(at: store.now) ?? 0) / 60) min")
                                .font(.system(size: compact ? 16 : 24)).lineLimit(2).fixedSize(horizontal: false, vertical: true)
                        }
                        Spacer(minLength: 8)
                        Text("History ›").font(.system(size: compact ? 16 : 20, weight: .medium))
                    }.frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                        .contentShape(.rect)
                }.buttonStyle(.plain).accessibilityLabel("Walk Zero history")
                VStack(spacing: 6) {
                    Button { store.toggleWalk() } label: {
                        Image(systemName: store.walks.activeWalk == nil ? "play.fill" : "stop.fill")
                            .font(.system(size: 24, weight: .semibold)).foregroundStyle(.black).frame(width: 72, height: 72)
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
    // Idle, local and remote walks share the same reading coordinates.
    private let panelCardHeight: CGFloat = 448

    var body: some View {
        ScrollView {
            GlassEffectContainer(spacing: 24) {
                VStack(alignment: .leading, spacing: 24) {
                    hero
                    let summary = store.walks.summary(at: store.now)
                    Group {
                        if compact {
                            HStack(spacing: 12) {
                                metric("This week", value: "\(summary.weeklyMinutes)", unit: "min")
                                metric("Average walk", value: "\(summary.averageMinutes)", unit: "min")
                                metric("Streak", value: "\(summary.streak)", unit: "days")
                            }
                        } else {
                            HStack(spacing: 24) {
                                HStack(spacing: 24) {
                                    metric("This week", value: "\(summary.weeklyMinutes)", unit: "min")
                                    metric("Average per walk", value: "\(summary.averageMinutes)", unit: "min")
                                }.padding(.horizontal, 28).frame(maxWidth: .infinity)
                                metric("Streak", value: "\(summary.streak)", unit: "days")
                                    .padding(.horizontal, 28).frame(width: 384)
                            }
                        }
                    }.padding(.vertical, 8)
                    let layout = compact ? AnyLayout(VStackLayout(alignment: .leading, spacing: 24)) : AnyLayout(HStackLayout(alignment: .top, spacing: 24))
                    layout {
                        chartCard
                        historyCard
                    }
                    if let reason = store.walkActivity.unavailableReason {
                        Text(reason).font(.callout).foregroundStyle(.secondary)
                    }
                }.padding(compact ? 24 : 48).frame(maxWidth: 1280).frame(maxWidth: .infinity)
            }
        }.scrollEdgeEffectStyle(.soft, for: .all)
    }

    private var hero: some View {
        let layout = compact ? AnyLayout(VStackLayout(alignment: .leading, spacing: 16)) : AnyLayout(HStackLayout(alignment: .center, spacing: 32))
        return layout {
            TimelineView(.periodic(from: store.now, by: 1)) { _ in
                VStack(alignment: .leading, spacing: 6) {
                    if let walk = store.walks.activeWalk {
                        Text("Elapsed").font(.system(size: 20, weight: .medium))
                        Text(walkElapsed(walk.duration(at: store.now)))
                            .font(.system(size: 64, weight: .medium, design: .rounded)).monospacedDigit()
                            .accessibilityIdentifier("walk-elapsed")
                        Text("Started on \(walk.startedBy.rawValue)")
                            .font(.system(size: compact ? 18 : 24)).foregroundStyle(.primary)
                    } else {
                        Label("Zero’s walks", systemImage: "pawprint.fill")
                            .font(.system(size: compact ? 32 : 48, weight: .semibold))
                        Text(store.walks.lastWalkLabel(at: store.now))
                            .font(.system(size: compact ? 20 : 24)).foregroundStyle(.primary)
                    }
                }.frame(height: 144, alignment: .center)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            Button(store.walks.activeWalk == nil ? "Start walk" : "End walk", systemImage: store.walks.activeWalk == nil ? "play.fill" : "stop.fill") {
                store.toggleWalk()
            }
            .font(.system(size: compact ? 18 : 24, weight: .semibold))
            .foregroundStyle(.black)
            .buttonStyle(.glassProminent).tint(.green).controlSize(compact ? .large : .extraLarge)
        }
    }

    private var chartCard: some View {
        VStack(alignment: .leading, spacing: 16) {
            let layout = compact ? AnyLayout(VStackLayout(alignment: .leading, spacing: 16)) : AnyLayout(HStackLayout())
            layout {
                Text("Time outdoors").font(.system(size: compact ? 22 : 28, weight: .semibold))
                if !compact { Spacer(minLength: 8) }
                Picker("Chart period", selection: $range) {
                    Text("7 days").tag(7)
                    Text("30 days").tag(30)
                }.pickerStyle(.segmented).controlSize(.extraLarge)
                    .frame(width: compact ? 200 : 216, height: 48)
            }.frame(height: compact ? nil : 48)
            Text("Minutes per day").font(.system(size: compact ? 16 : 20)).foregroundStyle(.secondary)
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
            .chartYAxis {
                AxisMarks(position: .leading, values: [0, 15, 30, 45, 60]) {
                    AxisGridLine()
                    AxisValueLabel().font(.system(size: compact ? 14 : 18)).foregroundStyle(.primary)
                }
            }
            .chartYScale(domain: 0...60)
            .frame(height: compact ? 220 : 288)
        }.padding(compact ? 24 : 28)
            .frame(maxWidth: .infinity)
            .frame(height: compact ? nil : panelCardHeight)
            .background(.regularMaterial, in: .rect(cornerRadius: 32))
            .accessibilityIdentifier("walk-chart")
    }

    private var historyCard: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Walk history").font(.system(size: compact ? 22 : 28, weight: .semibold))
                .frame(height: compact ? 32 : 48, alignment: .leading)
            if compact {
                historyRows
            } else {
                ScrollView { historyRows }
                    .scrollIndicators(.visible)
                    .frame(height: 288)
                    .scrollEdgeEffectStyle(.soft, for: .all)
            }
            Text(compact ? "\(store.walks.history.count) walks · Last 3 weeks" : "\(store.walks.history.count) walks · Scroll for more")
                .font(.system(size: compact ? 16 : 20)).foregroundStyle(.secondary)
                .frame(maxWidth: .infinity, alignment: .leading)
        }.padding(compact ? 24 : 28)
            .frame(width: compact ? nil : 384, height: compact ? nil : panelCardHeight, alignment: .topLeading)
            .background(.regularMaterial, in: .rect(cornerRadius: 32))
            .accessibilityIdentifier("walk-history")
    }

    private var historyRows: some View {
        LazyVStack(spacing: 0) {
            ForEach(store.walks.history) { walk in
                HStack {
                    VStack(alignment: .leading, spacing: 6) {
                        Text(fixtureTime(walk.startedAt, format: "EEE, MMM d"))
                            .font(.system(size: 20, weight: .medium))
                        Text(fixtureTime(walk.startedAt, format: "h:mm a"))
                            .font(.system(size: 20)).foregroundStyle(.secondary)
                    }
                    Spacer(minLength: 16)
                    Text("\(Int(walk.duration(at: store.now) / 60)) min")
                        .font(.system(size: 24, weight: .medium, design: .rounded)).monospacedDigit()
                }.frame(height: 96)
                    .overlay(alignment: .bottom) { Divider() }
            }
        }
    }

    private func metric(_ title: String, value: String, unit: String) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title).font(.system(size: compact ? 14 : 20)).foregroundStyle(.primary)
            HStack(alignment: .firstTextBaseline, spacing: 5) {
                Text(value).font(.system(size: compact ? 34 : 48, weight: .medium, design: .rounded)).monospacedDigit()
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
                WalkActivityContent(name: "Zero", startedAt: FixtureClock.now, previewElapsed: "12:34")
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
