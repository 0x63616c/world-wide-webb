import XCTest

@testable import StillCore

final class TrackingTests: XCTestCase {
  func testExportPreservesCompleteJournalAndUsesThePersistedFormat() throws {
    var journal = Journal()
    journal.medication = "Weekly medication"
    journal.weights = [
      WeightEntry(date: Date(timeIntervalSince1970: 100), kilograms: 80, note: "A note")
    ]
    journal.doses = [
      DoseEntry(
        date: Date(timeIntervalSince1970: 200), medication: journal.medication, milligrams: 7.5,
        note: "Dose note")
    ]
    journal.appearance = "dark"
    journal.goal = WeightGoal(kilograms: 75, date: Date(timeIntervalSince1970: 300))
    journal.schedule.weekdays = [2, 5]
    journal.lastHealthKitSync = Date(timeIntervalSince1970: 400)
    journal.healthKitWeightsEnabled = true

    let data = try JournalFile.export(journal)
    XCTAssertEqual(try JSONDecoder().decode(Journal.self, from: data), journal)
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: directory) }
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    let file = JournalFile(url: directory.appendingPathComponent("export.json"))
    try data.write(to: file.url)
    XCTAssertEqual(try file.load(), journal)
  }

  func testIncrementalHealthKitChangesPreserveManualWeightsAndApplyUpdatesAndDeletes() {
    let replacedID = UUID()
    let deletedID = UUID()
    let manual = WeightEntry(date: Date(timeIntervalSince1970: 100), kilograms: 80)
    var journal = Journal()
    journal.weights = [
      manual,
      WeightEntry(date: Date(timeIntervalSince1970: 200), kilograms: 79, healthKitID: replacedID),
      WeightEntry(date: Date(timeIntervalSince1970: 300), kilograms: 78, healthKitID: deletedID),
    ]
    let replacement = WeightEntry(
      date: Date(timeIntervalSince1970: 400), kilograms: 77, healthKitID: replacedID)

    journal.applyHealthKitWeightChanges(
      added: [replacement],
      deletedIDs: [deletedID],
      replacesAllHealthKitWeights: false
    )

    XCTAssertEqual(journal.weights, [manual, replacement])
  }

  func testFullHealthKitImportReplacesOnlyHealthWeights() {
    let manual = WeightEntry(date: Date(timeIntervalSince1970: 100), kilograms: 80)
    let current = WeightEntry(
      date: Date(timeIntervalSince1970: 300), kilograms: 78, healthKitID: UUID())
    var journal = Journal()
    journal.weights = [
      manual,
      WeightEntry(date: Date(timeIntervalSince1970: 200), kilograms: 79, healthKitID: UUID()),
    ]

    journal.applyHealthKitWeightChanges(
      added: [current], deletedIDs: [], replacesAllHealthKitWeights: true)

    XCTAssertEqual(journal.weights, [manual, current])
  }

  func testAnalyticsKeepsManualWeightsButCollapsesAnObviousHealthDuplicate() {
    let date = Date(timeIntervalSince1970: 1_000)
    let manualDuplicate = WeightEntry(date: date, kilograms: 71.2)
    let health = WeightEntry(
      date: date.addingTimeInterval(30), kilograms: 71.21, healthKitID: UUID(), sourceName: "Scale")
    let separateManual = WeightEntry(date: date.addingTimeInterval(3_600), kilograms: 71.2)

    let resolved = [manualDuplicate, health, separateManual].resolvedForAnalytics

    XCTAssertEqual(resolved, [health, separateManual])
  }
  func testOlderJournalLoadsWithNewFieldsDefaultedAndFutureSchemaIsRejected() throws {
    let old = Data(#"{"version":1,"weights":[],"doses":[],"medication":"Semaglutide"}"#.utf8)
    let journal = try JSONDecoder().decode(Journal.self, from: old)
    XCTAssertEqual(journal.vials, [])
    XCTAssertEqual(journal.halfLifeDays, 7)
    XCTAssertEqual(journal.resolvedMedicationModel, .semaglutide)
    XCTAssertThrowsError(
      try JSONDecoder().decode(Journal.self, from: Data(#"{"version":999}"#.utf8)))
  }
  func testNewJournalDoesNotInventADosingSchedule() {
    XCTAssertTrue(Journal().schedule.occurrences(after: Date(), count: 1).isEmpty)
  }
  func testWeightSummaryUsesChronologyAndExcludesFutureMeasurements() {
    let start = Date(timeIntervalSince1970: 1_700_000_000)
    let summary = WeightSummary(
      entries: [
        WeightEntry(date: start.addingTimeInterval(14 * 86400), kilograms: 98),
        WeightEntry(date: start, kilograms: 100),
        WeightEntry(date: start.addingTimeInterval(30 * 86400), kilograms: 80),
      ], now: start.addingTimeInterval(15 * 86400))
    XCTAssertEqual(summary.latest, 98)
    XCTAssertEqual(summary.lost, 2)
    XCTAssertEqual(summary.weeklyChange, -1)
  }
  func testDoseRejectsFutureTakenAndInvalidAmountsButAcceptsPlans() throws {
    let now = Date(timeIntervalSince1970: 1_700_000_000)
    var dose = DoseEntry(
      date: now.addingTimeInterval(3600), medication: "Semaglutide", milligrams: 0.5)
    XCTAssertThrowsError(try dose.validate(now: now))
    dose.status = .planned
    XCTAssertNoThrow(try dose.validate(now: now))
    dose.milligrams = -1
    XCTAssertThrowsError(try dose.validate(now: now))
  }
  func testTwiceWeeklyScheduleKeepsLocalTimeAcrossDaylightSaving() {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(identifier: "America/Los_Angeles")!
    let start = calendar.date(from: DateComponents(year: 2026, month: 3, day: 6, hour: 12))!
    var schedule = DoseSchedule()
    schedule.weekdays = [1, 4]
    let dates = schedule.occurrences(after: start, count: 3, calendar: calendar)
    XCTAssertEqual(dates.map { calendar.component(.day, from: $0) }, [8, 11, 15])
    XCTAssertEqual(dates.map { calendar.component(.hour, from: $0) }, [9, 9, 9])
  }
  func testEveryFourDayScheduleKeepsLocalTimeAcrossDaylightSaving() {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(identifier: "America/Los_Angeles")!
    let anchor = calendar.date(from: DateComponents(year: 2026, month: 3, day: 6, hour: 12))!
    let beforeAnchor = calendar.date(from: DateComponents(year: 2026, month: 3, day: 5, hour: 12))!
    var schedule = DoseSchedule()
    schedule.startDate = anchor
    schedule.intervalDays = 4
    let dates = schedule.occurrences(after: beforeAnchor, count: 4, calendar: calendar)
    XCTAssertEqual(dates.map { calendar.component(.day, from: $0) }, [6, 10, 14, 18])
    XCTAssertEqual(dates.map { calendar.component(.hour, from: $0) }, [9, 9, 9, 9])
  }
  func testStartingWeightHistoryAtFirstDoseRemovesEarlierWeights() {
    let firstDose = Date(timeIntervalSince1970: 2_000)
    var journal = Journal()
    journal.weights = [
      WeightEntry(date: Date(timeIntervalSince1970: 1_000), kilograms: 80),
      WeightEntry(date: firstDose, kilograms: 79),
      WeightEntry(date: Date(timeIntervalSince1970: 3_000), kilograms: 78),
    ]
    journal.doses = [
      DoseEntry(
        date: Date(timeIntervalSince1970: 500), medication: "Semaglutide", milligrams: 0,
        status: .skipped),
      DoseEntry(date: firstDose, medication: "Semaglutide", milligrams: 0.5),
    ]
    journal.weightsStartAtFirstDose = true

    journal.applyWeightHistoryStart()

    XCTAssertEqual(journal.weights.map(\.kilograms), [79, 78])
    XCTAssertEqual(journal.firstTakenDoseDate, firstDose)
  }
  func testJournalPersistsEditsAndPreservesMedicationHistory() throws {
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: directory) }
    let file = JournalFile(url: directory.appendingPathComponent("journal.json"))
    var journal = Journal()
    journal.doses = [
      DoseEntry(
        date: Date(timeIntervalSince1970: 1_700_000_000), medication: "Semaglutide",
        milligrams: 0.5, concentration: 5, note: "A quiet morning")
    ]
    try file.save(journal)
    var edited = try file.load()
    XCTAssertEqual(edited, journal)
    guard !edited.doses.isEmpty else { return }
    edited.medication = "Tirzepatide"
    edited.doses[0].note = "Updated note"
    try file.save(edited)
    let reloaded = try file.load()
    XCTAssertEqual(reloaded.doses[0].medication, "Semaglutide")
    XCTAssertEqual(reloaded.doses[0].note, "Updated note")
  }
  func testOverdueRemainsUntilExplicitlyLoggedOrSkippedWithoutMovingSchedule() {
    var cal = Calendar(identifier: .gregorian)
    cal.timeZone = TimeZone(secondsFromGMT: 0)!
    let monday = cal.date(from: DateComponents(year: 2026, month: 9, day: 7, hour: 9))!
    var schedule = DoseSchedule()
    schedule.weekdays = [2, 5]
    schedule.startDate = monday
    let tuesday = monday.addingTimeInterval(86400)
    XCTAssertEqual(schedule.outstanding(asOf: tuesday, doses: [], calendar: cal), [monday])
    let late = DoseEntry(
      date: tuesday, scheduledDate: monday, medication: "Semaglutide", milligrams: 0.5)
    XCTAssertEqual(schedule.outstanding(asOf: tuesday, doses: [late], calendar: cal), [])
    XCTAssertEqual(
      cal.component(
        .weekday, from: schedule.occurrences(after: tuesday, count: 1, calendar: cal)[0]), 5)
  }
  func testCustomDatesDriveTheScheduleAndSurviveAnUnevenGap() {
    var cal = Calendar(identifier: .gregorian)
    cal.timeZone = TimeZone(secondsFromGMT: 0)!
    let day = { (d: Int) in cal.date(from: DateComponents(year: 2026, month: 9, day: d))! }
    var schedule = DoseSchedule()
    schedule.hour = 8
    schedule.minute = 30
    schedule.customDates = [day(14), day(7), day(10), day(7)]

    XCTAssertEqual(schedule.cadence, .custom)
    let upcoming = schedule.occurrences(after: day(8), count: 5, calendar: cal)
    XCTAssertEqual(
      upcoming,
      [day(10), day(14)].map { cal.date(bySettingHour: 8, minute: 30, second: 0, of: $0)! })
    // A three-day gap then a four-day gap: no single interval could produce this.
    XCTAssertEqual(cal.dateComponents([.day], from: day(7), to: day(10)).day, 3)
    XCTAssertEqual(
      schedule.outstanding(asOf: day(8), doses: [], calendar: cal),
      [cal.date(bySettingHour: 8, minute: 30, second: 0, of: day(7))!])
  }
  func testClearingASchedulePlansNothingAndDisablesReminders() {
    var schedule = DoseSchedule()
    schedule.weekdays = [2, 5]
    schedule.intervalDays = 4
    schedule.customDates = [Date()]
    schedule.enabled = true

    schedule.clear()

    XCTAssertEqual(schedule.cadence, .none)
    XCTAssertFalse(schedule.enabled)
    XCTAssertTrue(schedule.occurrences(after: Date(), count: 5).isEmpty)
    XCTAssertTrue(schedule.outstanding(asOf: Date(), doses: []).isEmpty)
  }
  func testScheduleProjectionUsesRecentDosesAndNeverDoublesUpOrInventsWithoutHistory() {
    var cal = Calendar(identifier: .gregorian)
    cal.timeZone = TimeZone(secondsFromGMT: 0)!
    let now = cal.date(from: DateComponents(year: 2026, month: 9, day: 9, hour: 12))!
    var journal = Journal()
    journal.schedule.customDates = [11, 15, 40].map {
      cal.date(from: DateComponents(year: 2026, month: 9, day: $0))!
    }

    // Without a recorded dose there is no usual amount, so nothing is drawn.
    XCTAssertTrue(
      journal.scheduledProjection(
        from: now, through: now.addingTimeInterval(14 * 86400), calendar: cal
      ).isEmpty)

    journal.doses = [
      DoseEntry(
        date: now.addingTimeInterval(-7 * 86400), medication: "Semaglutide", milligrams: 0.4),
      DoseEntry(
        date: now.addingTimeInterval(-3 * 86400), medication: "Semaglutide", milligrams: 0.6),
    ]
    let projection = journal.scheduledProjection(
      from: now, through: now.addingTimeInterval(14 * 86400), calendar: cal)
    XCTAssertEqual(projection.count, 2, "Only the two dates inside the window")
    XCTAssertEqual(projection.map(\.milligrams), [0.5, 0.5])
    XCTAssertTrue(projection.allSatisfy { $0.status == .planned })

    // A dose already logged on a scheduled day keeps its own record.
    journal.doses.append(
      DoseEntry(
        date: cal.date(from: DateComponents(year: 2026, month: 9, day: 11, hour: 8))!,
        medication: "Semaglutide", milligrams: 0.5, status: .planned))
    XCTAssertEqual(
      journal.scheduledProjection(
        from: now, through: now.addingTimeInterval(14 * 86400), calendar: cal
      ).count, 1)
  }
  func testProjectedSchedulesNeverCountTowardsTheCurrentLevel() {
    let now = Date(timeIntervalSince1970: 1_700_000_000)
    var journal = Journal()
    journal.doses = [
      DoseEntry(date: now.addingTimeInterval(-86400), medication: "Semaglutide", milligrams: 1)
    ]
    journal.schedule.customDates = [now.addingTimeInterval(2 * 86400)]
    let projection = journal.scheduledProjection(
      from: now, through: now.addingTimeInterval(14 * 86400))
    XCTAssertEqual(projection.count, 1)

    let recorded = MedicationLevel.remaining(
      at: now, doses: journal.doses, medication: "Semaglutide", halfLifeDays: 7, includePlans: true,
      now: now, model: .halfLife)
    let withProjection = MedicationLevel.remaining(
      at: now, doses: journal.doses + projection, medication: "Semaglutide", halfLifeDays: 7,
      includePlans: true, now: now, model: .halfLife)
    XCTAssertEqual(recorded, withProjection, accuracy: 1e-12)
    XCTAssertGreaterThan(
      MedicationLevel.remaining(
        at: now.addingTimeInterval(3 * 86400), doses: journal.doses + projection,
        medication: "Semaglutide", halfLifeDays: 7, includePlans: true, now: now, model: .halfLife),
      MedicationLevel.remaining(
        at: now.addingTimeInterval(3 * 86400), doses: journal.doses, medication: "Semaglutide",
        halfLifeDays: 7, includePlans: true, now: now, model: .halfLife)
    )
  }
  func testJournalWrittenBeforeCustomDatesAndSyncStampStillOpens() throws {
    let old = Data(
      #"{"version":1,"weights":[],"doses":[],"medication":"Semaglutide","schedule":{"weekdays":[2],"startDate":0,"hour":9,"minute":0,"enabled":true}}"#
        .utf8)
    let journal = try JSONDecoder().decode(Journal.self, from: old)
    XCTAssertEqual(journal.schedule.weekdays, [2])
    XCTAssertEqual(journal.schedule.cadence, .weekdays)
    XCTAssertTrue(journal.schedule.customDates.isEmpty)
    XCTAssertNil(journal.lastHealthKitSync)
  }
  func testSyringeUnitsRequireScaleAndConvertUsingVialConcentration() throws {
    let vial = Vial(received: Date(), medication: "Semaglutide", concentration: 5, volumeML: 2)
    XCTAssertEqual(vial.totalMilligrams, 10)
    XCTAssertEqual(try vial.milligrams(units: 3, unitsPerML: 100), 0.15, accuracy: 0.000001)
    XCTAssertThrowsError(try vial.milligrams(units: 3, unitsPerML: 0))
    XCTAssertThrowsError(try vial.milligrams(units: -3, unitsPerML: 100))
  }
  func testAbsorptionModelMatchesIndependentIntegrationAndStartsAtZero() {
    let start = Date(timeIntervalSince1970: 1_700_000_000)
    let dose = DoseEntry(date: start, medication: "Semaglutide", milligrams: 1)
    // Fixed values from scripts/absorption_reference.py (independent RK4 integration).
    for (model, expected) in [
      (
        MedicationModel.semaglutide,
        [0.021060421626, 0.354583889016, 0.563089039286, 0.460457116966, 0.227180051501]
      ),
      (
        .tirzepatide,
        [0.029098184638, 0.416136562924, 0.536849850677, 0.376834602383, 0.174225352517]
      ),
    ] {
      XCTAssertEqual(
        MedicationLevel.remaining(
          at: start, doses: [dose], medication: "Semaglutide", halfLifeDays: 7, now: start,
          model: model), 0)
      for (hours, value) in zip([1, 24, 72, 168, 336], expected) {
        XCTAssertEqual(
          MedicationLevel.remaining(
            at: start.addingTimeInterval(Double(hours) * 3600), doses: [dose],
            medication: "Semaglutide", halfLifeDays: 7, now: start, model: model), value,
          accuracy: 0.000000001)
      }
    }
  }
  func testAbsorptionPlansOnlyAffectFutureAndNeverIncludeSkippedOrOtherMedications() {
    let start = Date(timeIntervalSince1970: 1_700_000_000)
    let planDate = start.addingTimeInterval(48 * 3600)
    let doses = [
      DoseEntry(date: start, medication: "Semaglutide", milligrams: 1),
      DoseEntry(date: planDate, medication: "Semaglutide", milligrams: 0.5, status: .planned),
      DoseEntry(date: start, medication: "Semaglutide", milligrams: 9, status: .skipped),
      DoseEntry(date: start, medication: "Other", milligrams: 9),
      DoseEntry(date: planDate, medication: "Semaglutide", milligrams: 9),
      DoseEntry(
        date: start.addingTimeInterval(-3600), medication: "Semaglutide", milligrams: 9,
        status: .planned),
    ]
    let current = start.addingTimeInterval(24 * 3600)
    XCTAssertEqual(
      MedicationLevel.remaining(
        at: current, doses: doses, medication: "Semaglutide", halfLifeDays: 7, includePlans: true,
        now: current, model: .semaglutide), 0.354583889016, accuracy: 1e-9)
    let future = start.addingTimeInterval(72 * 3600)
    XCTAssertEqual(
      MedicationLevel.remaining(
        at: future, doses: doses, medication: "Semaglutide", halfLifeDays: 7, includePlans: true,
        now: current, model: .semaglutide), 0.740380983794, accuracy: 1e-9)
    XCTAssertEqual(
      MedicationLevel.remaining(
        at: future, doses: doses, medication: "Semaglutide", halfLifeDays: 7, now: current,
        model: .semaglutide), 0.563089039286, accuracy: 1e-9)
  }
  func testHalfLifeModelAddsOnlyMatchingTakenDosesAndExplicitFuturePlans() {
    let start = Date(timeIntervalSince1970: 1_700_000_000)
    let doses = [
      DoseEntry(date: start, medication: "Semaglutide", milligrams: 1),
      DoseEntry(date: start, medication: "Tirzepatide", milligrams: 5),
      DoseEntry(
        date: start.addingTimeInterval(7 * 86400), medication: "Semaglutide", milligrams: 1,
        status: .planned),
    ]
    let week = start.addingTimeInterval(7 * 86400)
    XCTAssertEqual(
      MedicationLevel.remaining(
        at: week, doses: doses, medication: "Semaglutide", halfLifeDays: 7, now: start), 0.5,
      accuracy: 0.000001)
    XCTAssertEqual(
      MedicationLevel.remaining(
        at: week, doses: doses, medication: "Semaglutide", halfLifeDays: 7, includePlans: true,
        now: start), 1.5, accuracy: 0.000001)
    XCTAssertEqual(
      MedicationLevel.remaining(
        at: start.addingTimeInterval(-1), doses: doses, medication: "Semaglutide", halfLifeDays: 7,
        now: start), 0)
  }
  func testWeightInputRejectsJunkAndImpossibleValuesAndSupportsLocaleDecimal() {
    let us = Locale(identifier: "en_US")
    XCTAssertEqual(EntryValidation.number("195.5", locale: us), 195.5)
    XCTAssertEqual(EntryValidation.number("88,5", locale: Locale(identifier: "de_DE")), 88.5)
    for input in ["12abc", "NaN", "1e4", "-90", "1,2,3", ""] {
      XCTAssertNil(EntryValidation.number(input, locale: us))
    }
    XCTAssertFalse(EntryValidation.weight(0))
    XCTAssertTrue(EntryValidation.weight(453.59237))
    XCTAssertFalse(EntryValidation.weight(453.6))
    XCTAssertFalse(EntryValidation.weight(900))
    XCTAssertFalse(EntryValidation.weight(.infinity))
    XCTAssertTrue(EntryValidation.weight(88.5))
  }
  func testGoalPaceUsesFutureDeadlineAndDoesNotInventCalories() {
    let now = Date(timeIntervalSince1970: 1_700_000_000)
    let goal = WeightGoal(kilograms: 80, date: now.addingTimeInterval(10 * 7 * 86400))
    XCTAssertEqual(goal.requiredWeeklyChange(current: 90, now: now), -1)
    XCTAssertNil(WeightGoal(kilograms: 80, date: now).requiredWeeklyChange(current: 90, now: now))
    XCTAssertNil(WeightGoal(kilograms: 80).requiredWeeklyChange(current: 90, now: now))
  }
}

final class InjectionSideTests: XCTestCase {
  func testSideAbbreviationsAndAccessibilityNames() {
    XCTAssertEqual(InjectionSide.left.abbreviation, "L")
    XCTAssertEqual(InjectionSide.right.abbreviation, "R")
    XCTAssertEqual(InjectionSide.left.accessibilityName, "Left side")
    XCTAssertEqual(InjectionSide.right.accessibilityName, "Right side")
  }

  func testDoseWithoutSideHasNoSideLabel() {
    let dose = DoseEntry(
      date: Date(timeIntervalSince1970: 1_000), medication: "Example", milligrams: 0.5)
    XCTAssertNil(dose.side?.abbreviation)
    XCTAssertNil(dose.side?.accessibilityName)
  }

  func testNoHistoryStartsOnRight() {
    XCTAssertEqual(Journal().injectionStartSide, .right)
    XCTAssertEqual(InjectionSide.suggestedNext(in: []), .right)
  }

  func testNoHistoryUsesStartOnLeft() {
    XCTAssertEqual(InjectionSide.suggestedNext(in: [], startOn: .left), .left)
  }

  func testKnownSideSuggestsItsOppositeRegardlessOfPreference() {
    let date = Date(timeIntervalSince1970: 1_000)
    for side in InjectionSide.allCases {
      let dose = DoseEntry(date: date, medication: "Example", milligrams: 0.5, side: side)
      let expected: InjectionSide = side == .left ? .right : .left
      for startOn in InjectionSide.allCases {
        XCTAssertEqual(InjectionSide.suggestedNext(in: [dose], startOn: startOn), expected)
      }
    }
  }

  func testNewerUnknownSidesFallBackToLastKnownSide() {
    let doses = [
      DoseEntry(date: Date(timeIntervalSince1970: 4_000), medication: "Example", milligrams: 0.5),
      DoseEntry(date: Date(timeIntervalSince1970: 3_000), medication: "Example", milligrams: 0.5),
      DoseEntry(
        date: Date(timeIntervalSince1970: 2_000), medication: "Example", milligrams: 0.5,
        side: .right),
      DoseEntry(
        date: Date(timeIntervalSince1970: 1_000), medication: "Example", milligrams: 0.5,
        side: .left),
    ]
    XCTAssertEqual(InjectionSide.suggestedNext(in: doses), .left)
  }

  func testSuggestionUsesDoseDateInsteadOfArrayOrScheduledOrder() {
    let older = DoseEntry(
      date: Date(timeIntervalSince1970: 1_000), scheduledDate: Date(timeIntervalSince1970: 5_000),
      medication: "Example", milligrams: 0.5, side: .left)
    let newest = DoseEntry(
      date: Date(timeIntervalSince1970: 3_000), scheduledDate: Date(timeIntervalSince1970: 500),
      medication: "Example", milligrams: 0.5, side: .right)
    let middle = DoseEntry(
      date: Date(timeIntervalSince1970: 2_000), medication: "Example", milligrams: 0.5, side: .left)
    for doses in [[older, newest, middle], [middle, newest, older], [newest, middle, older]] {
      XCTAssertEqual(InjectionSide.suggestedNext(in: doses), .left)
    }
  }

  func testPlannedAndSkippedDosesDoNotDriveTheSuggestion() {
    let doses = [
      DoseEntry(
        date: Date(timeIntervalSince1970: 1_000), medication: "Example", milligrams: 0.5,
        side: .left),
      DoseEntry(
        date: Date(timeIntervalSince1970: 2_000), medication: "Example", milligrams: 0.5,
        status: .skipped, side: .left),
      DoseEntry(
        date: Date(timeIntervalSince1970: 3_000), medication: "Example", milligrams: 0.5,
        status: .planned, side: .right),
    ]
    XCTAssertEqual(InjectionSide.suggestedNext(in: doses), .right)
  }

  func testAlternatesAcrossConsecutiveLogs() {
    var doses: [DoseEntry] = []
    var logged: [InjectionSide] = []
    for day in 0..<4 {
      let next = InjectionSide.suggestedNext(in: doses)
      logged.append(next)
      doses.append(
        DoseEntry(
          date: Date(timeIntervalSince1970: Double(day) * 86_400), medication: "Example",
          milligrams: 0.5, side: next))
    }
    XCTAssertEqual(logged, [.right, .left, .right, .left])
  }

  func testAllUnknownSidesUseStartOnPreference() {
    let doses = [
      DoseEntry(date: Date(timeIntervalSince1970: 1_000), medication: "Example", milligrams: 0.5),
      DoseEntry(date: Date(timeIntervalSince1970: 2_000), medication: "Example", milligrams: 0.5),
    ]
    XCTAssertEqual(InjectionSide.suggestedNext(in: doses), .right)
    XCTAssertEqual(InjectionSide.suggestedNext(in: doses, startOn: .left), .left)
  }

  func testLegacyJournalWithoutSidesLoadsAndPreservesHistoricalFieldsOnSave() throws {
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: directory) }
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    let file = JournalFile(url: directory.appendingPathComponent("journal.json"))
    let legacy = Data(
      #"{"version":1,"medication":"Current medication","doses":[{"id":"11111111-1111-1111-1111-111111111111","date":1000,"scheduledDate":900,"medication":"Historical medication","milligrams":0.5,"concentration":5,"status":"taken","note":"Synthetic legacy record","vialID":"22222222-2222-2222-2222-222222222222","syringeUnits":10,"syringeUnitsPerML":100}]}"#
        .utf8)
    try legacy.write(to: file.url)

    var journal = try file.load()
    let dose = try XCTUnwrap(journal.doses.first)
    XCTAssertNil(dose.side)
    XCTAssertEqual(journal.injectionStartSide, .right)
    XCTAssertEqual(dose.id, UUID(uuidString: "11111111-1111-1111-1111-111111111111"))
    XCTAssertEqual(dose.date, Date(timeIntervalSinceReferenceDate: 1_000))
    XCTAssertEqual(dose.scheduledDate, Date(timeIntervalSinceReferenceDate: 900))
    XCTAssertEqual(dose.medication, "Historical medication")
    XCTAssertEqual(dose.milligrams, 0.5)
    XCTAssertEqual(dose.concentration, 5)
    XCTAssertEqual(dose.status, .taken)
    XCTAssertEqual(dose.note, "Synthetic legacy record")
    XCTAssertEqual(dose.vialID, UUID(uuidString: "22222222-2222-2222-2222-222222222222"))
    XCTAssertEqual(dose.syringeUnits, 10)
    XCTAssertEqual(dose.syringeUnitsPerML, 100)

    journal.injectionStartSide = .left
    try file.save(journal)
    let reloaded = try file.load()
    XCTAssertEqual(reloaded, journal)
    XCTAssertEqual(
      reloaded.doses, [dose], "Changing the preference must not backfill historical sides")
    XCTAssertEqual(reloaded.version, 1)
  }

  func testExplicitNullSideDecodesAsUnknown() throws {
    let data = Data(
      #"{"id":"11111111-1111-1111-1111-111111111111","date":1000,"medication":"Example","milligrams":0.5,"status":"taken","note":"","side":null}"#
        .utf8)
    let dose = try JSONDecoder().decode(DoseEntry.self, from: data)
    XCTAssertNil(dose.side)
  }

  func testJournalRoundTripsBothSidesUnknownAndPreference() throws {
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: directory) }
    let file = JournalFile(url: directory.appendingPathComponent("journal.json"))
    var journal = Journal()
    journal.injectionStartSide = .left
    journal.doses = [
      DoseEntry(
        date: Date(timeIntervalSince1970: 1_000), medication: "Example", milligrams: 0.5,
        side: .left),
      DoseEntry(
        date: Date(timeIntervalSince1970: 2_000), medication: "Example", milligrams: 0.5,
        side: .right),
      DoseEntry(date: Date(timeIntervalSince1970: 3_000), medication: "Example", milligrams: 0.5),
    ]
    try file.save(journal)
    let reloaded = try file.load()
    XCTAssertEqual(reloaded, journal)
    XCTAssertEqual(
      InjectionSide.suggestedNext(in: reloaded.doses, startOn: reloaded.injectionStartSide), .left)

    journal.doses[1].side = .left
    try file.save(journal)
    let edited = try file.load()
    XCTAssertEqual(edited, journal)
    XCTAssertEqual(
      InjectionSide.suggestedNext(in: edited.doses, startOn: edited.injectionStartSide), .right)
  }
}

final class MedicationRateTests: XCTestCase {
  func testHalfLifeSlopeMatchesAnalyticDerivative() {
    let date = Date(timeIntervalSince1970: 1_700_000_000)
    let dose = DoseEntry(date: date, medication: "Example", milligrams: 1)
    let rate = MedicationLevel.rate(
      at: date, doses: [dose], medication: "Example", halfLifeDays: 7, now: date)
    XCTAssertEqual(rate, -log(2) / 168, accuracy: 1e-8)
  }
  func testUpcomingDoseDoesNotCreateSpuriousSlope() {
    let date = Date(timeIntervalSince1970: 1_700_000_000)
    var dose = DoseEntry(date: date.addingTimeInterval(0.5), medication: "Example", milligrams: 1)
    dose.status = .planned
    XCTAssertEqual(
      MedicationLevel.rate(
        at: date, doses: [dose], medication: "Example", halfLifeDays: 7, includePlans: true,
        now: date), 0)
  }
  func testAbsorptionRisesThenFalls() {
    let date = Date(timeIntervalSince1970: 1_700_000_000)
    for model in [MedicationModel.semaglutide, .tirzepatide] {
      let dose = DoseEntry(date: date, medication: "Example", milligrams: 1)
      XCTAssertGreaterThan(
        MedicationLevel.rate(
          at: date, doses: [dose], medication: "Example", halfLifeDays: 7, now: date, model: model),
        0)
      XCTAssertLessThan(
        MedicationLevel.rate(
          at: date.addingTimeInterval(336 * 3600), doses: [dose], medication: "Example",
          halfLifeDays: 7, now: date, model: model), 0)
    }
  }
  func testTrendThresholdIsSymmetricAndScaleIndependent() {
    XCTAssertEqual(MedicationLevel.trend(rate: 0, reference: 1), 0)
    XCTAssertEqual(MedicationLevel.trend(rate: 0.004, reference: 1), 1)
    XCTAssertEqual(MedicationLevel.trend(rate: -0.004, reference: 1), -1)
    XCTAssertEqual(MedicationLevel.trend(rate: 0.005, reference: 1), 2)
    XCTAssertEqual(MedicationLevel.trend(rate: -0.005, reference: 1), -2)
    XCTAssertEqual(MedicationLevel.trend(rate: -0.01, reference: 2), -2)
    XCTAssertEqual(MedicationLevel.trend(rate: .nan, reference: 1), 0)
  }
}
