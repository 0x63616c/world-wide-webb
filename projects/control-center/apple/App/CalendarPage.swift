import PanelKit
import SwiftUI

/// Today at a glance on the left; the selected day's timeline on the right.
struct CalendarPage: View {
    let provider: any CalendarProvider
    let now: Date
    /// Days from today. The strip shows the 7-day page containing it.
    @State private var selectedOffset = 0
    @State private var pagedForward = true
    @State private var showingCalendars = false
    @Namespace private var dayPill

    private static let accent = Color(red: 1, green: 0.27, blue: 0.23)

    private var calendar: Calendar { provider.dayCalendar }
    private var today: Date { calendar.startOfDay(for: now) }
    private var selectedDay: Date { day(selectedOffset) }
    private var week: Int { selectedOffset / 7 }
    private static let lastOffset = 52 * 7 + 6
    private func select(_ offset: Int) {
        let offset = min(Self.lastOffset, max(0, offset))
        guard offset != selectedOffset else { return }
        pagedForward = offset > selectedOffset
        withAnimation(.snappy(duration: 0.3)) { selectedOffset = offset }
    }
    /// A mostly horizontal swipe; taps and vertical scrolling pass through.
    private func swipe(by step: Int) -> some Gesture {
        DragGesture(minimumDistance: 24).onEnded { drag in
            guard abs(drag.translation.width) > 50, abs(drag.translation.width) > abs(drag.translation.height) * 1.5
            else { return }
            select(selectedOffset + (drag.translation.width < 0 ? step : -step))
        }
    }
    private func day(_ offset: Int) -> Date { calendar.date(byAdding: .day, value: offset, to: today) ?? today }

    private func entries(_ events: [AgendaEvent]) -> [CalendarEntry] {
        events.map { event in
            let start =
                event.start
                ?? calendar.date(bySettingHour: event.hour, minute: event.minute, second: 0, of: today) ?? today
            return CalendarEntry(
                id: event.id, title: event.title, place: event.place, start: start,
                end: event.end ?? start.addingTimeInterval(Double(event.duration) * 60), isAllDay: event.isAllDay,
                color: event.color.map { Color(red: $0.red, green: $0.green, blue: $0.blue) } ?? Self.accent)
        }
    }
    private func occurring(on day: Date, from entries: [CalendarEntry]) -> [CalendarEntry] {
        let end = calendar.date(byAdding: .day, value: 1, to: day) ?? day
        return entries.filter { $0.start < end && $0.end > day }
    }

    var body: some View {
        // Up next and Later stay anchored to now; the strip and day follow the browsed week.
        let upcoming = entries(provider.events + provider.later)
        let entries = upcoming + entries(provider.browsed.filter { event in !upcoming.contains { $0.id == event.id } })
        let next =
            provider.next(at: now).flatMap { next in upcoming.first { $0.id == next.id } }
            ?? upcoming.first { $0.start > now }
        GeometryReader { proxy in
            if proxy.size.width >= 900 {
                HStack(alignment: .top, spacing: 36) {
                    VStack(alignment: .leading, spacing: 0) {
                        hero(large: true)
                        weekStrip(entries).padding(.top, 30)
                        upNext(next).padding(.top, 20)
                        comingUp(upcoming, after: next).padding(.top, 26)
                        Spacer(minLength: 20)
                        calendarsButton
                    }
                    .frame(width: min(420, max(330, proxy.size.width * 0.31)))
                    dayPanel(entries, hourHeight: 84)
                }
                .padding(.horizontal, 40).padding(.top, 4).padding(.bottom, 32)
            } else {
                ScrollView {
                    VStack(alignment: .leading, spacing: 20) {
                        hero(large: false)
                        weekStrip(entries)
                        upNext(next)
                        dayHeader(occurring(on: selectedDay, from: entries))
                        agenda(occurring(on: selectedDay, from: entries))
                        calendarsButton
                    }.padding(.horizontal, 20).padding(.bottom, 32)
                }
            }
        }
        .foregroundStyle(.white)
        .background { atmosphere(next?.color ?? Self.accent).ignoresSafeArea() }
        .background(DismissSwipeBlocker())
        .environment(\.colorScheme, .dark)
        .task(id: BrowseKey(week: week, loaded: (provider.events + provider.later).map(\.id))) {
            await provider.browse(from: week == 0 ? nil : day(week * 7))
        }
        .sheet(isPresented: $showingCalendars) {
            if let live = provider as? LiveCalendarProvider { CalendarPickerSheet(provider: live) }
        }
    }

    // MARK: Today

    private func hero(large: Bool) -> some View {
        Button {
            select(0)
        } label: {
            heroLabel(large: large)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(provider.dateText(at: now, format: "EEEE, MMMM d, yyyy"))
        .accessibilityHint("Shows today")
        .accessibilityIdentifier("calendar-today")
    }

    private func heroLabel(large: Bool) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(provider.dateText(at: now, format: "EEEE").uppercased())
                .font(.system(size: large ? 21 : 15, weight: .bold)).kerning(large ? 3 : 2)
                .foregroundStyle(Self.accent)
            Text(provider.dateText(at: now, format: "d"))
                .font(.system(size: large ? 168 : 84, weight: .bold, design: .rounded)).kerning(large ? -6 : -3)
                .contentTransition(.numericText())
                .padding(.vertical, large ? -22 : -8)
            Text(provider.dateText(at: now, format: "MMMM yyyy"))
                .font(.system(size: large ? 28 : 20, weight: .medium)).foregroundStyle(.white.opacity(0.6))
        }
        .contentShape(.rect)
    }

    private func weekStrip(_ entries: [CalendarEntry]) -> some View {
        HStack(spacing: 4) {
            ForEach(week * 7..<week * 7 + 7, id: \.self) { offset in
                let date = day(offset)
                let selected = offset == selectedOffset
                let colors = occurring(on: date, from: entries).map(\.color).uniqued().prefix(3)
                Button {
                    select(offset)
                } label: {
                    VStack(spacing: 7) {
                        Text(provider.dateText(at: date, format: "EEEEE"))
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(selected ? AnyShapeStyle(.black.opacity(0.55)) : AnyShapeStyle(.secondary))
                        Text(provider.dateText(at: date, format: "d"))
                            .font(.system(size: 23, weight: .semibold, design: .rounded))
                            .foregroundStyle(selected ? .black : offset == 0 ? Self.accent : .white)
                        HStack(spacing: 3) {
                            ForEach(Array(colors.enumerated()), id: \.offset) { _, color in
                                Circle().fill(selected ? Color.black.opacity(0.7) : color).frame(width: 5, height: 5)
                            }
                        }.frame(height: 5)
                    }
                    .frame(maxWidth: .infinity).frame(height: 88)
                    .background {
                        if selected {
                            RoundedRectangle(cornerRadius: 20, style: .continuous).fill(.white)
                                .matchedGeometryEffect(id: "day", in: dayPill)
                        }
                    }
                    .contentShape(.rect)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(provider.dateText(at: date, format: "EEEE d"))
                .accessibilityAddTraits(selected ? .isSelected : [])
                .accessibilityIdentifier("calendar-day-\(offset)")
            }
        }
        .id(week)
        .transition(.push(from: pagedForward ? .trailing : .leading))
        .padding(6)
        .clipShape(.rect(cornerRadius: 26))
        .glassEffect(.regular, in: .rect(cornerRadius: 26))
        .contentShape(.rect(cornerRadius: 26))
        .simultaneousGesture(swipe(by: 7))
        .accessibilityAction(named: "Next week") { select(selectedOffset + 7) }
        .accessibilityAction(named: "Previous week") { select(selectedOffset - 7) }
    }

    @ViewBuilder private func upNext(_ next: CalendarEntry?) -> some View {
        if let next {
            let live = next.start <= now && !next.isAllDay
            Button {
                select(dayOf: next)
            } label: {
                VStack(alignment: .leading, spacing: 14) {
                    HStack {
                        HStack(spacing: 7) {
                            Circle().fill(next.color).frame(width: 9, height: 9)
                            Text(live ? "NOW" : "UP NEXT").font(.system(size: 13, weight: .bold)).kerning(1.5)
                        }
                        Spacer()
                        Text(countdown(next)).font(.system(size: 16, weight: .semibold)).monospacedDigit()
                            .foregroundStyle(.white.opacity(0.7)).contentTransition(.numericText())
                    }
                    Text(next.title).font(.system(size: 30, weight: .semibold)).lineLimit(2)
                        .multilineTextAlignment(.leading)
                    VStack(alignment: .leading, spacing: 8) {
                        Label(next.isAllDay ? "All day" : timeRange(next), systemImage: "clock")
                        if let place = next.place { Label(place, systemImage: "mappin.and.ellipse").lineLimit(1) }
                    }
                    .font(.system(size: 18, weight: .medium)).foregroundStyle(.white.opacity(0.75))
                    if live {
                        let span = max(1, next.end.timeIntervalSince(next.start))
                        ProgressView(value: min(1, max(0, now.timeIntervalSince(next.start) / span)))
                            .tint(next.color.mix(with: .white, by: 0.35)).padding(.top, 2)
                    }
                }
                .padding(24).frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(.rect(cornerRadius: 34))
            }
            .buttonStyle(.plain)
            .glassEffect(.regular.tint(next.color.opacity(0.3)).interactive(), in: .rect(cornerRadius: 34))
            .accessibilityIdentifier("calendar-up-next")
        } else {
            VStack(alignment: .leading, spacing: 10) {
                Image(systemName: "sparkles").font(.system(size: 26, weight: .medium)).foregroundStyle(Self.accent)
                Text("Nothing coming up").font(.system(size: 26, weight: .semibold))
                Text("No upcoming events.").font(.system(size: 18)).foregroundStyle(.white.opacity(0.6))
            }
            .padding(24).frame(maxWidth: .infinity, alignment: .leading)
            .glassEffect(.regular, in: .rect(cornerRadius: 34))
        }
    }

    /// The few events after the featured one, across the week.
    @ViewBuilder private func comingUp(_ entries: [CalendarEntry], after next: CalendarEntry?) -> some View {
        let later = entries.filter { $0.id != next?.id && $0.start > now }.prefix(4)
        if !later.isEmpty {
            VStack(alignment: .leading, spacing: 4) {
                Text("LATER").font(.system(size: 13, weight: .bold)).kerning(1.5).foregroundStyle(.white.opacity(0.45))
                    .padding(.leading, 8).padding(.bottom, 4)
                ForEach(later) { entry in
                    Button {
                        select(dayOf: entry)
                    } label: {
                        HStack(spacing: 14) {
                            Capsule().fill(entry.color).frame(width: 4, height: 38)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(entry.title).font(.system(size: 19, weight: .semibold)).lineLimit(1)
                                Text(
                                    "\(weekday(entry)) · \(entry.isAllDay ? "All day" : provider.dateText(at: entry.start, format: "h:mm a"))"
                                )
                                .font(.system(size: 15, weight: .medium)).foregroundStyle(.white.opacity(0.55))
                            }
                            Spacer(minLength: 0)
                        }
                        .padding(.horizontal, 8).frame(height: 58).contentShape(.rect)
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    private func select(dayOf entry: CalendarEntry) {
        let offset = calendar.dateComponents([.day], from: today, to: calendar.startOfDay(for: max(entry.start, now)))
        select(offset.day ?? 0)
    }

    @ViewBuilder private var calendarsButton: some View {
        if let live = provider as? LiveCalendarProvider {
            Button {
                showingCalendars = true
            } label: {
                HStack(spacing: 10) {
                    HStack(spacing: -5) {
                        ForEach(live.calendars.filter { live.selectedCalendarIDs.contains($0.id) }.prefix(4)) { item in
                            Circle().fill(Color(red: item.red, green: item.green, blue: item.blue))
                                .frame(width: 14, height: 14)
                                .overlay(Circle().stroke(.black.opacity(0.5), lineWidth: 1.5))
                        }
                    }
                    Text("Calendars").font(.system(size: 17, weight: .semibold))
                }.padding(.horizontal, 8).frame(minHeight: 36)
            }
            .buttonStyle(.glass)
            .accessibilityIdentifier("calendar-picker")
        }
    }

    // MARK: Selected day

    private func dayPanel(_ entries: [CalendarEntry], hourHeight: CGFloat) -> some View {
        let dayEntries = occurring(on: selectedDay, from: entries)
        return VStack(alignment: .leading, spacing: 0) {
            dayHeader(dayEntries).padding(.horizontal, 28).padding(.top, 24).padding(.bottom, 16)
            Rectangle().fill(.white.opacity(0.08)).frame(height: 1)
            timeline(dayEntries.filter { !$0.isAllDay }, hourHeight: hourHeight)
        }
        .background(.white.opacity(0.055), in: .rect(cornerRadius: 40))
        .clipShape(.rect(cornerRadius: 40))
        .simultaneousGesture(swipe(by: 1))
    }

    private func dayHeader(_ dayEntries: [CalendarEntry]) -> some View {
        let allDay = dayEntries.filter(\.isAllDay)
        return VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .firstTextBaseline, spacing: 12) {
                Text(
                    selectedOffset == 0
                        ? "Today" : selectedOffset == 1 ? "Tomorrow" : provider.dateText(at: selectedDay, format: "EEEE")
                )
                .font(.system(size: 32, weight: .bold))
                Text(provider.dateText(at: selectedDay, format: "MMM d")).font(.system(size: 20, weight: .medium))
                    .foregroundStyle(.white.opacity(0.5))
                Spacer()
                Text(dayEntries.isEmpty ? "No events" : dayEntries.count == 1 ? "1 event" : "\(dayEntries.count) events")
                    .font(.system(size: 17, weight: .medium)).foregroundStyle(.white.opacity(0.5))
            }
            if !allDay.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(allDay) { entry in
                            HStack(spacing: 8) {
                                Image(systemName: "sun.max.fill").font(.system(size: 13, weight: .semibold))
                                    .foregroundStyle(entry.color.mix(with: .white, by: 0.5))
                                Text(entry.title).font(.system(size: 16, weight: .semibold)).lineLimit(1)
                            }
                            .padding(.horizontal, 14).frame(height: 38)
                            .background(entry.color.opacity(0.32), in: .capsule)
                        }
                    }
                }
            }
        }
    }

    private func timeline(_ timed: [CalendarEntry], hourHeight: CGFloat) -> some View {
        let dayStart = selectedDay
        let dayEnd = calendar.date(byAdding: .day, value: 1, to: dayStart) ?? dayStart
        let slots = DayTimeline.slots(
            timed.map { entry in
                (
                    entry.id, entry.start <= dayStart ? 0 : minute(entry.start),
                    entry.end >= dayEnd ? 24 * 60 : minute(entry.end)
                )
            })
        let nowMinute = selectedOffset == 0 ? minute(now) : nil
        let gutter: CGFloat = 68
        return ScrollViewReader { scroll in
            ScrollView {
                ZStack(alignment: .topLeading) {
                    VStack(spacing: 0) {
                        ForEach(0..<24, id: \.self) { hour in
                            HStack(alignment: .top, spacing: 12) {
                                Text(hour == 0 ? "12 AM" : hour < 12 ? "\(hour) AM" : hour == 12 ? "Noon" : "\(hour - 12) PM")
                                    .font(.system(size: 13, weight: .medium)).foregroundStyle(.white.opacity(0.45))
                                    .frame(width: gutter - 12, alignment: .trailing).offset(y: -8)
                                    .opacity(nowMinute.map { abs($0 - hour * 60) < 16 } == true ? 0 : 1)
                                Rectangle().fill(.white.opacity(0.09)).frame(height: 1)
                            }
                            .frame(height: hourHeight, alignment: .top).id(hour)
                        }
                    }
                    GeometryReader { proxy in
                        let lane = proxy.size.width - gutter
                        ForEach(slots) { slot in
                            if let entry = timed.first(where: { $0.id == slot.id }) {
                                let height = CGFloat(slot.end - slot.start) / 60 * hourHeight - 3
                                block(entry, height: height)
                                    .frame(width: lane / CGFloat(slot.columns) - 4, height: height)
                                    .offset(
                                        x: gutter + lane * CGFloat(slot.column) / CGFloat(slot.columns),
                                        y: CGFloat(slot.start) / 60 * hourHeight + 1)
                            }
                        }
                        if let nowMinute {
                            HStack(spacing: 0) {
                                Text(provider.dateText(at: now, format: "h:mm"))
                                    .font(.system(size: 13, weight: .bold)).monospacedDigit()
                                    .padding(.horizontal, 7).frame(height: 22)
                                    .background(Self.accent, in: .capsule)
                                    .frame(width: gutter - 4, alignment: .trailing)
                                Rectangle().fill(Self.accent).frame(height: 2)
                            }
                            .offset(y: CGFloat(nowMinute) / 60 * hourHeight - 11)
                            .accessibilityHidden(true)
                        }
                    }
                }
                .padding(.top, 20).padding(.bottom, 24).padding(.trailing, 24).padding(.leading, 8)
            }
            .overlay {
                if timed.isEmpty {
                    VStack(spacing: 10) {
                        Image(systemName: "calendar").font(.system(size: 34, weight: .medium))
                        Text("Nothing scheduled").font(.system(size: 22, weight: .semibold))
                    }
                    .foregroundStyle(.white.opacity(0.35)).allowsHitTesting(false)
                }
            }
            .onAppear { scroll.scrollTo(firstHour(timed, nowMinute: nowMinute), anchor: UnitPoint(x: 0, y: 0.03)) }
            .onChange(of: selectedOffset) {
                withAnimation(.snappy(duration: 0.35)) {
                    scroll.scrollTo(firstHour(timed, nowMinute: nowMinute), anchor: UnitPoint(x: 0, y: 0.03))
                }
            }
        }
    }

    /// Today opens an hour before now; other days an hour before their first event.
    private func firstHour(_ timed: [CalendarEntry], nowMinute: Int?) -> Int {
        if let nowMinute { return max(0, nowMinute / 60 - 1) }
        guard let first = timed.map(\.start).min(), first > selectedDay else { return timed.isEmpty ? 8 : 0 }
        return max(0, minute(first) / 60 - 1)
    }

    private func block(_ entry: CalendarEntry, height: CGFloat) -> some View {
        let past = entry.end <= now
        let live = entry.start <= now && !past
        let detail = [timeRange(entry), entry.place].compactMap { $0 }.joined(separator: " · ")
        return HStack(spacing: 10) {
            Capsule().fill(entry.color).frame(width: 4)
            Group {
                if height >= 58 {
                    VStack(alignment: .leading, spacing: 3) {
                        Text(entry.title).font(.system(size: 19, weight: .semibold)).lineLimit(height >= 96 ? 2 : 1)
                        Text(detail).font(.system(size: 15, weight: .medium)).lineLimit(1)
                            .foregroundStyle(entry.color.mix(with: .white, by: 0.6))
                    }
                } else {
                    HStack(alignment: .firstTextBaseline, spacing: 10) {
                        Text(entry.title).font(.system(size: 17, weight: .semibold)).lineLimit(1)
                        Text(timeRange(entry)).font(.system(size: 14, weight: .medium)).lineLimit(1)
                            .foregroundStyle(entry.color.mix(with: .white, by: 0.6))
                    }
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: height >= 58 ? .topLeading : .leading)
        }
        .padding(.leading, 6).padding(.trailing, 12).padding(.vertical, 6)
        .background(entry.color.opacity(live ? 0.5 : 0.32), in: .rect(cornerRadius: 14))
        .opacity(past ? 0.45 : 1)
    }

    /// Narrow canvases list the day instead of plotting it.
    @ViewBuilder private func agenda(_ dayEntries: [CalendarEntry]) -> some View {
        let timed = dayEntries.filter { !$0.isAllDay }
        if timed.isEmpty {
            Text("Nothing scheduled").font(.system(size: 18, weight: .medium)).foregroundStyle(.white.opacity(0.45))
                .frame(maxWidth: .infinity, minHeight: 120)
        } else {
            VStack(spacing: 8) {
                ForEach(timed) { entry in block(entry, height: 68).frame(height: 68) }
            }
        }
    }

    // MARK: Text

    private func minute(_ date: Date) -> Int {
        calendar.component(.hour, from: date) * 60 + calendar.component(.minute, from: date)
    }

    private func timeRange(_ entry: CalendarEntry) -> String {
        "\(provider.dateText(at: entry.start, format: "h:mm a")) – \(provider.dateText(at: entry.end, format: "h:mm a"))"
    }

    private func countdown(_ entry: CalendarEntry) -> String {
        if entry.isAllDay { return calendar.isDate(entry.start, inSameDayAs: now) || entry.start < now ? "Today" : weekday(entry) }
        if entry.start <= now {
            return "\(duration(entry.end.timeIntervalSince(now))) left"
        }
        if !calendar.isDate(entry.start, inSameDayAs: now), entry.start.timeIntervalSince(now) > 12 * 3600 {
            return weekday(entry)
        }
        return "in \(duration(entry.start.timeIntervalSince(now)))"
    }
    private func weekday(_ entry: CalendarEntry) -> String {
        if calendar.isDate(entry.start, inSameDayAs: now) { return "Today" }
        if entry.start >= day(7) { return provider.dateText(at: entry.start, format: "EEE, MMM d") }
        return calendar.isDate(entry.start, inSameDayAs: day(1))
            ? "Tomorrow" : provider.dateText(at: entry.start, format: "EEEE")
    }
    private func duration(_ interval: TimeInterval) -> String {
        let minutes = max(1, Int((interval / 60).rounded(.up)))
        if minutes < 60 { return "\(minutes) min" }
        return minutes % 60 == 0 ? "\(minutes / 60) hr" : "\(minutes / 60) hr \(minutes % 60) min"
    }

    // MARK: Backdrop

    /// Soft colour for the glass to pick up; the panel stays essentially black.
    private func atmosphere(_ glow: Color) -> some View {
        ZStack {
            Color.black
            RadialGradient(
                colors: [Self.accent.opacity(0.24), .clear], center: UnitPoint(x: 0.08, y: 0.02), startRadius: 0,
                endRadius: 620)
            RadialGradient(
                colors: [glow.opacity(0.22), .clear], center: UnitPoint(x: 0.18, y: 0.72), startRadius: 0,
                endRadius: 520)
        }
        .animation(.smooth(duration: 0.6), value: glow)
    }
}

/// The launcher's zoom transition closes an app on any rightward or downward swipe.
/// Calendar pages by swipe, so this claims pans inside it before the transition can.
private struct DismissSwipeBlocker: UIViewRepresentable {
    func makeUIView(context: Context) -> Probe { Probe() }
    func updateUIView(_ view: Probe, context: Context) {}

    final class Probe: UIView, UIGestureRecognizerDelegate {
        private let pan = UIPanGestureRecognizer()

        override func didMoveToWindow() {
            super.didMoveToWindow()
            isUserInteractionEnabled = false
            pan.view?.removeGestureRecognizer(pan)
            guard window != nil else { return }
            var responder: UIResponder? = self
            while let next = responder?.next {
                if let controller = next as? UIViewController, controller.parent is UINavigationController {
                    pan.cancelsTouchesInView = false
                    pan.delegate = self
                    controller.view.addGestureRecognizer(pan)
                    return
                }
                responder = next
            }
        }

        func gestureRecognizer(
            _ recognizer: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer
        ) -> Bool { isContent(other) }

        func gestureRecognizer(
            _ recognizer: UIGestureRecognizer, shouldBeRequiredToFailBy other: UIGestureRecognizer
        ) -> Bool { !isContent(other) }

        /// The page's own gestures and scroll views keep working; the navigation
        /// transition's recognizers sit on this view or above it and must wait.
        private func isContent(_ other: UIGestureRecognizer) -> Bool {
            guard let host = pan.view, let view = other.view else { return true }
            if view !== host { return view.isDescendant(of: host) }
            return NSStringFromClass(type(of: other)).contains("SwiftUI")
        }
    }
}

private struct BrowseKey: Equatable {
    let week: Int
    let loaded: [String]
}

private struct CalendarEntry: Identifiable {
    let id: String
    let title: String
    let place: String?
    let start: Date
    let end: Date
    let isAllDay: Bool
    let color: Color
}

extension Array where Element: Equatable {
    fileprivate func uniqued() -> [Element] {
        reduce(into: []) { result, element in if !result.contains(element) { result.append(element) } }
    }
}

private struct CalendarPickerSheet: View {
    let provider: LiveCalendarProvider
    @Environment(\.dismiss) private var dismiss

    private var sources: [String] {
        Set(provider.calendars.map(\.sourceID)).sorted { lhs, rhs in
            let left = provider.calendars.first { $0.sourceID == lhs }?.sourceTitle ?? ""
            let right = provider.calendars.first { $0.sourceID == rhs }?.sourceTitle ?? ""
            return left == right ? lhs < rhs : left.localizedStandardCompare(right) == .orderedAscending
        }
    }

    var body: some View {
        NavigationStack {
            List {
                Button("Show all") { Task { await provider.showAllCalendars() } }
                    .accessibilityIdentifier("calendar-show-all")
                ForEach(sources, id: \.self) { source in
                    Section(provider.calendars.first { $0.sourceID == source }?.sourceTitle ?? "Calendars") {
                        ForEach(
                            provider.calendars.filter { $0.sourceID == source }.sorted {
                                $0.title == $1.title
                                    ? $0.id < $1.id : $0.title.localizedStandardCompare($1.title) == .orderedAscending
                            }
                        ) { calendar in
                            Toggle(
                                isOn: Binding(
                                    get: { provider.selectedCalendarIDs.contains(calendar.id) },
                                    set: { shown in
                                        Task { await provider.setCalendarShown(shown, identifier: calendar.id) }
                                    }
                                )
                            ) {
                                HStack {
                                    Circle().fill(Color(red: calendar.red, green: calendar.green, blue: calendar.blue))
                                        .frame(width: 12, height: 12).accessibilityHidden(true)
                                    Text(calendar.title)
                                }
                            }
                            .tint(.green)
                            .accessibilityIdentifier("calendar-selection-\(calendar.id)")
                        }
                    }
                }
            }
            .disabled(provider.savingSelection)
            .navigationTitle("Calendars")
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }.accessibilityIdentifier("calendar-picker-done")
                }
            }
        }
    }
}
