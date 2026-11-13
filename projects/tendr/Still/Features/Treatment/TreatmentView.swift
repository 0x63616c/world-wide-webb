import RDesign
import SwiftUI

struct TreatmentView: View {
  @Binding var tab: Int
  @Binding var journalFilter: String
  @Environment(\.dynamicTypeSize) private var dynamicTypeSize
  @Environment(Store.self) private var store
  @State private var editing = false
  @State private var schedule = false
  @State private var addVial = false
  @State private var selectedVial: Vial?
  private var summaryLayout: AnyLayout {
    dynamicTypeSize.isAccessibilitySize
      ? AnyLayout(VStackLayout(alignment: .leading, spacing: 8))
      : AnyLayout(HStackLayout(alignment: .firstTextBaseline))
  }
  var cadenceSummary: String? {
    let schedule = store.journal.schedule
    switch schedule.cadence {
    case .none: return "Tap to choose your dose days"
    case .weekdays: return nil
    case .interval: return schedule.intervalDays.map { "Every \($0) days" }
    case .custom:
      let upcoming = schedule.occurrences(after: Date(), count: 64).count
      return upcoming == 0
        ? "Custom dates · none upcoming"
        : "Custom · \(upcoming) date\(upcoming == 1 ? "" : "s") ahead"
    }
  }
  var reminderSummary: String {
    guard store.journal.schedule.cadence != .none else { return "No reminders" }
    return store.journal.schedule.enabled ? store.reminderStatus : "Reminders off"
  }
  var taken: [DoseEntry] {
    store.journal.doses.filter {
      $0.medication == store.journal.medication && $0.status == .taken && $0.date <= Date()
    }.sorted { $0.date > $1.date }
  }
  var body: some View {
    NavigationStack {
      ScrollView {
        VStack(alignment: .leading, spacing: 22) {
          PageHeader("Treatment").padding(.horizontal, 8)
          Button {
            editing = true
          } label: {
            HStack(spacing: 15) {
              Image(systemName: "syringe.fill").font(.title2).foregroundStyle(Theme.pine).frame(
                width: 48, height: 48
              ).rSurface(Theme.sage, cornerRadius: 14)
              VStack(alignment: .leading, spacing: 5) {
                Text(store.journal.medication).font(.title3.bold())
                Text("Treatment details").font(.caption).foregroundStyle(.secondary)
              }
              Spacer()
              Image(systemName: "chevron.right").font(.caption).foregroundStyle(.secondary)
            }.card()
          }.buttonStyle(.plain)
          Button {
            schedule = true
          } label: {
            VStack(alignment: .leading, spacing: 16) {
              HStack {
                Label("Your schedule", systemImage: "calendar").font(.headline)
                Spacer()
                Image(systemName: "chevron.right").font(.caption).foregroundStyle(.secondary)
              }
              switch store.journal.schedule.cadence {
              case .none:
                Text("No schedule set").font(.subheadline.weight(.medium)).foregroundStyle(
                  .secondary)
              case .weekdays:
                HStack(spacing: 0) {
                  ForEach([2, 3, 4, 5, 6, 7, 1], id: \.self) { day in
                    Text(String(Calendar.current.shortWeekdaySymbols[day - 1].prefix(1))).font(
                      .caption.weight(.semibold)
                    ).frame(maxWidth: .infinity).frame(minHeight: 36).background(
                      store.journal.schedule.weekdays.contains(day) ? Theme.pine : Color.clear,
                      in: Circle()
                    ).foregroundStyle(
                      store.journal.schedule.weekdays.contains(day)
                        ? Theme.background : Color.secondary)
                  }
                }
              case .interval, .custom:
                UpcomingDoseDates(
                  dates: store.journal.schedule.occurrences(after: Date(), count: 4))
              }
              // Stack summaries at accessibility sizes instead of compressing them.
              summaryLayout {
                if let summary = cadenceSummary {
                  Text(summary).font(.caption).foregroundStyle(.secondary)
                }
                if !dynamicTypeSize.isAccessibilitySize { Spacer(minLength: 8) }
                Label(
                  reminderSummary,
                  systemImage: store.journal.schedule.enabled
                    && store.journal.schedule.cadence != .none ? "bell" : "bell.slash"
                )
                .font(.caption).foregroundStyle(.secondary).layoutPriority(1)
              }
            }.card()
          }.buttonStyle(.plain).accessibilityIdentifier("editSchedule")
          HStack {
            Text("Vials").font(.title3.bold())
            Spacer()
            Button {
              addVial = true
            } label: {
              Image(systemName: "plus.circle.fill").font(.largeTitle)
            }.frame(width: 52, height: 52).accessibilityLabel("Add Vial")
          }
          if store.journal.vials.isEmpty {
            Button("Add your first vial") { addVial = true }.frame(maxWidth: .infinity).card()
          }
          ForEach(store.journal.vials.sorted { $0.received > $1.received }) { vial in
            Button {
              selectedVial = vial
            } label: {
              VialSummary(vial: vial)
            }.buttonStyle(.plain)
          }
          if !taken.isEmpty {
            Button {
              journalFilter = "Doses"
              tab = 3
            } label: {
              VStack(alignment: .leading, spacing: 16) {
                HStack {
                  Text("Dose history").font(.headline)
                  Spacer()
                  Text("\(taken.count)").font(.subheadline.weight(.semibold)).foregroundStyle(
                    .secondary)
                }
                HStack {
                  Text("Taken")
                  Spacer()
                  Text("\(number(taken.reduce(0) { $0 + $1.milligrams }, digits: 2)) mg")
                    .foregroundStyle(.secondary)
                }.font(.subheadline)
                ForEach(taken.prefix(3)) { dose in
                  HStack(spacing: 4) {
                    Image(systemName: "checkmark.circle.fill").foregroundStyle(Theme.pine)
                    Text(dose.date, format: .dateTime.month(.abbreviated).day())
                    (Text("(") + Text(dose.date, format: .dateTime.weekday(.abbreviated))
                      + Text(")"))
                      .foregroundStyle(.secondary)
                    Spacer()
                    Text("\(number(dose.milligrams, digits: 3)) mg").monospacedDigit()
                  }.font(.subheadline)
                }
                if taken.count > 3 {
                  Text("+\(taken.count - 3) more").font(.subheadline).foregroundStyle(.secondary)
                }
              }.card().contentShape(Rectangle())
            }.buttonStyle(.plain).accessibilityIdentifier("doseHistoryCard")
              .accessibilityHint("Opens Journal with Doses selected")
          }
        }.padding(.horizontal, 16).padding(.bottom, 24).tendrReadableWidth()
      }.background(Theme.background).tendrRootNavigationBar()
        .sheet(isPresented: $editing) { TreatmentEditor().tendrSheet() }
        .sheet(isPresented: $schedule) { ScheduleEditor().tendrSheet() }
        .sheet(isPresented: $addVial) { VialEditor().tendrSheet() }
        .sheet(item: $selectedVial) { VialEditor(vial: $0).tendrSheet() }
    }
  }
}

/// The next few dose dates as compact day chips.
struct UpcomingDoseDates: View {
  let dates: [Date]
  var body: some View {
    if dates.isEmpty {
      Text("No upcoming dates").font(.subheadline.weight(.medium)).foregroundStyle(.secondary)
        .frame(maxWidth: .infinity, alignment: .leading)
    } else {
      HStack(spacing: 8) {
        ForEach(dates, id: \.self) { date in
          VStack(spacing: 4) {
            Text(date, format: .dateTime.weekday(.narrow)).font(.caption2.weight(.bold))
              .foregroundStyle(Theme.pine)
            Text(date, format: .dateTime.day()).font(.subheadline.weight(.semibold))
          }.frame(maxWidth: .infinity).padding(.vertical, 8).rSurface(Theme.sage, cornerRadius: 12)
        }
      }
    }
  }
}
