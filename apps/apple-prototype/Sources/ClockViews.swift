import SwiftUI

struct ClockController: View {
    let store: any HomeDataSource
    var newAlarm = Alarm()
    var save: ((Alarm) async throws -> Void)? = nil
    @State private var editing: Alarm?
    @State private var deleting: Alarm?
    @Environment(\.horizontalSizeClass) private var sizeClass
    var body: some View {
        if let alarm = editing {
            AlarmEditor(initial: alarm, store: store, save: save) { editing = nil }.id(alarm.id)
        } else if sizeClass == .compact {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    TimelineView(.periodic(from: .now, by: 1)) { _ in
                        VStack(alignment: .leading, spacing: 8) {
                            Text(greeting).font(.title3).foregroundStyle(.secondary)
                            Text(fixtureTime(store.now)).font(.system(size: 72, weight: .light)).monospacedDigit()
                            Text(fixtureTime(store.now, format: "EEEE, MMMM d")).foregroundStyle(.secondary)
                        }
                    }
                    HStack {
                        Text("Alarms").font(.title2.bold())
                        Spacer()
                        Button("Add", systemImage: "plus") { editing = newAlarm }.buttonStyle(.glass)
                    }
                    ForEach(store.alarms) { alarm in
                        VStack(spacing: 16) {
                            HStack {
                                Button { editing = alarm } label: {
                                    VStack(alignment: .leading, spacing: 6) {
                                        Text(alarm.time).font(.system(size: 40, weight: .light))
                                        Text(alarm.label).font(.headline)
                                        Text(alarm.date.isEmpty ? days(alarm.repeatDays) : alarm.date).font(.caption).foregroundStyle(.secondary)
                                    }
                                }.buttonStyle(.plain)
                                Spacer()
                                Toggle("Enable \(alarm.label)", isOn: Binding(get: { alarm.enabled }, set: { store.send(.enableAlarm(alarm.id, $0)) })).labelsHidden().tint(.green)
                            }
                            HStack {
                                Text(alarm.timeZone).font(.caption).foregroundStyle(.secondary)
                                Spacer()
                                Button("Delete", role: .destructive) { deleting = alarm }.font(.subheadline).buttonStyle(.glass)
                            }
                        }.padding(20).homeGlass(radius: 28)
                    }
                    if store.alarms.isEmpty { Text("No alarms yet").foregroundStyle(.secondary) }
                }.padding(24)
            }.confirmationDialog("Delete \(deleting?.label ?? "alarm")?", isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } })) {
                Button("Delete alarm", role: .destructive) { if let alarm = deleting { store.send(.deleteAlarm(alarm.id)) }; deleting = nil }
                Button("Cancel", role: .cancel) { deleting = nil }
            }
        } else {
            HStack(spacing: 65) {
                TimelineView(.periodic(from: .now, by: 1)) { _ in
                    VStack(alignment: .leading, spacing: 20) {
                        Text(greeting).font(.system(size: 30)).opacity(0.7)
                        HStack(alignment: .firstTextBaseline, spacing: 8) {
                            Text(fixtureTime(store.now)).font(.system(size: 124, weight: .ultraLight)).monospacedDigit()
                            Text(fixtureTime(store.now, format: "a")).font(.system(size: 26)).opacity(0.65)
                        }
                        Text(fixtureTime(store.now, format: "EEEE, MMMM d, yyyy")).font(.system(size: 24))
                        Label("San Francisco", systemImage: "location.fill").font(.system(size: 20)).opacity(0.6)
                        Spacer().frame(height: 30)
                        if let next = nextAlarm {
                            VStack(alignment: .leading, spacing: 13) {
                                SectionLabel(text: "Next alarm")
                                Text(next.0.label).font(.system(size: 28, weight: .medium))
                                Text(nextDescription(next.1, zone: next.0.timeZone)).font(.system(size: 21)).opacity(0.7)
                            }.padding(26).frame(maxWidth: .infinity, alignment: .leading)
                                .glassEffect(.regular, in: .rect(cornerRadius: 30))
                        } else {
                            Text("No upcoming alarms").font(.system(size: 24)).opacity(0.65)
                        }
                    }
                }.frame(maxWidth: .infinity, alignment: .leading)
                VStack(alignment: .leading, spacing: 24) {
                    HStack {
                        Text("Alarms").font(.system(size: 30, weight: .semibold))
                        Spacer()
                        Button("Add alarm", systemImage: "plus") { editing = newAlarm }.buttonStyle(.glass)
                    }
                    ScrollView {
                        VStack(spacing: 18) {
                            ForEach(store.alarms) { alarm in
                                HStack(spacing: 12) {
                                    Button { editing = alarm } label: {
                                        VStack(alignment: .leading, spacing: 10) {
                                            Text(alarm.time).font(.system(size: 49, weight: .light))
                                            Text(alarm.label).font(.system(size: 22, weight: .semibold))
                                            Text(alarm.date.isEmpty ? days(alarm.repeatDays) : alarm.date).font(.system(size: 16)).opacity(0.65)
                                            Text(alarm.timeZone).font(.system(size: 14)).opacity(0.5)
                                        }.frame(maxWidth: .infinity, alignment: .leading)
                                    }.buttonStyle(.plain).accessibilityLabel("Edit \(alarm.label)")
                                    Toggle("Enable \(alarm.label)", isOn: Binding(get: { alarm.enabled }, set: { store.send(.enableAlarm(alarm.id, $0)) })).labelsHidden().tint(.mint)
                                    Button { deleting = alarm } label: { Image(systemName: "trash").frame(width: 40, height: 44) }.buttonStyle(.plain).accessibilityLabel("Delete \(alarm.label)")
                                }.padding(24).glassEffect(.regular, in: .rect(cornerRadius: 30)).opacity(alarm.enabled ? 1 : 0.55)
                            }
                            if store.alarms.isEmpty { Text("No alarms yet").font(.system(size: 26)).padding(40) }
                        }
                    }
                }.frame(maxWidth: .infinity)
            }.padding(.horizontal, 65).padding(.vertical, 70)
            .confirmationDialog("Delete \(deleting?.label ?? "alarm")?", isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } })) {
                Button("Delete alarm", role: .destructive) { if let alarm = deleting { store.send(.deleteAlarm(alarm.id)) }; deleting = nil }
                Button("Cancel", role: .cancel) { deleting = nil }
            }
        }
    }
    private var greeting: String {
        let hour = Int(fixtureTime(store.now, format: "H")) ?? 15
        return hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening"
    }
    private func nextDescription(_ date: Date, zone: String) -> String {
        let formatter = DateFormatter()
        formatter.timeZone = TimeZone(identifier: zone)
        formatter.dateFormat = "EEEE, h:mm a z"
        return formatter.string(from: date)
    }
    private var nextAlarm: (Alarm, Date)? {
        store.upcomingAlarm(at: store.now).map { ($0.alarm, $0.due) }
    }
    private func days(_ values: Set<Int>) -> String {
        values.isEmpty ? "Once" : values.sorted().map { ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][$0] }.joined(separator: " · ")
    }
}
struct AlarmEditor: View {
    let store: any HomeDataSource
    let close: () -> Void
    let save: ((Alarm) async throws -> Void)?
    @State private var saving = false
    @State private var alarm: Alarm
    @State private var error: String?
    @Environment(\.horizontalSizeClass) private var sizeClass
    init(initial: Alarm, store: any HomeDataSource, save: ((Alarm) async throws -> Void)? = nil, close: @escaping () -> Void) {
        self.store = store; self.save = save; self.close = close; _alarm = State(initialValue: initial)
    }
    var body: some View {
        let fields = sizeClass == .compact ? AnyLayout(VStackLayout(spacing: 18)) : AnyLayout(HStackLayout(spacing: 28))
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                Text(alarm.id == 0 ? "New alarm" : "Edit alarm").font(.system(size: 34, weight: .semibold))
                fields {
                    field("Label", text: $alarm.label)
                    field("Time", text: $alarm.time, hint: "07:00")
                }
                fields {
                    field("Date", text: $alarm.date, hint: "YYYY-MM-DD · blank for next occurrence")
                    field("Time zone", text: $alarm.timeZone)
                }
                if alarm.date.isEmpty {
                    SectionLabel(text: "Repeat · no days selected means once")
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 72), spacing: 8)], spacing: 12) {
                        ForEach(0..<7) { day in
                            Choice(title: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][day], selected: alarm.repeatDays.contains(day)) {
                                if alarm.repeatDays.contains(day) { alarm.repeatDays.remove(day) } else { alarm.repeatDays.insert(day) }
                            }
                        }
                    }
                }
                field("Snooze minutes", text: $alarm.snoozeMinutes, hint: "9")
                field("Light entities or scene", text: $alarm.lightTarget, hint: "Blank uses the home default")
                if let error { Text(error).foregroundStyle(.yellow).accessibilityLabel(error) }
                HStack {
                    Button("Cancel", action: close).keyboardShortcut(.cancelAction)
                    Spacer()
                    Button("Save alarm") {
                        if let validation = alarm.validationError { error = validation }
                        else if let save {
                            saving = true
                            Task { @MainActor in
                                defer { saving = false }
                                do { try await save(alarm); close() }
                                catch { self.error = error.localizedDescription }
                            }
                        } else { store.send(.saveAlarm(alarm)); close() }
                    }.keyboardShortcut(.defaultAction).disabled(saving)
                }.buttonStyle(.glass).controlSize(.large)
            }.padding(sizeClass == .compact ? 24 : 42).frame(maxWidth: 1000)
        }
    }
    private func field(_ title: String, text: Binding<String>, hint: String = "") -> some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionLabel(text: title)
            TextField(hint, text: text).textFieldStyle(.plain).font(.system(size: 23))
                .padding(17).background(.white.opacity(0.1), in: .rect(cornerRadius: 17)).accessibilityLabel(title)
        }
    }
}
#Preview("Clock & alarms", traits: .fixedLayout(width: 1366, height: 1024)) { ControllerPreview(tile: .clock) }
