import XCTest

final class StillUITests: XCTestCase {
    @MainActor func testPrimaryPageHeadersShareOnePosition() {
        let app = XCUIApplication()
        app.launchArguments = ["--demo", "--uitest"]
        app.launch()

        let home = app.staticTexts["pageHeader-Tendr"]
        XCTAssertTrue(home.waitForExistence(timeout: 10))
        let origin = home.frame.origin

        for (tab, title) in [("Treatment", "Treatment"), ("Progress", "Progress"), ("Journal", "Journal"), ("Settings", "Settings")] {
            app.buttons[tab].tap()
            let header = app.staticTexts["pageHeader-\(title)"]
            XCTAssertTrue(header.waitForExistence(timeout: 3))
            XCTAssertEqual(header.frame.minX, origin.x, accuracy: 1)
            XCTAssertEqual(header.frame.minY, origin.y, accuracy: 1)
        }
    }

    @MainActor func testPreviewScreensAndLogging() throws {
        let app = XCUIApplication()
        app.launchArguments = ["--demo", "--uitest"]
        app.launch()
        app.buttons["Home"].tap()
        XCTAssertTrue(app.buttons["logDose"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.images["medicationTrendIndicator"].exists)
        XCTAssertFalse(app.buttons["Include explicitly planned doses"].exists)
        capture("Home")
        XCTAssertFalse(app.buttons["vialCard"].exists, "Home shows no vial tile until a vial exists")
        app.buttons["logDose"].tap()
        XCTAssertTrue(app.textFields["doseAmount"].waitForExistence(timeout: 3))
        capture("Log dose")
        app.buttons["Cancel"].tap()
        app.buttons["Progress"].tap()
        capture("Progress")
        app.buttons["Journal"].tap()
        capture("Journal")
        app.buttons["Settings"].tap()
        XCTAssertTrue(app.staticTexts["Settings"].waitForExistence(timeout: 3))
        XCTAssertTrue(app.buttons["Connect Apple Health"].exists)
        capture("Settings")
        app.buttons["Home"].tap()
    }
    @MainActor func testPolishedFiltersAndVials() {
        let app = XCUIApplication()
        app.launchArguments = ["--demo", "--uitest"]
        app.launch()
        XCTAssertTrue(app.buttons["logDose"].waitForExistence(timeout: 10))
        capture("Polish Home")
        app.swipeUp()
        capture("Polish Home collapsed")
        app.buttons["Treatment"].tap()
        capture("Polish Treatment")
        app.buttons["Journal"].tap()
        app.buttons["Doses"].tap()
        XCTAssertTrue(app.buttons["Doses"].isSelected)
        XCTAssertFalse(app.staticTexts["Weight"].exists)
        app.buttons["Weight"].tap()
        XCTAssertTrue(app.buttons["Weight"].isSelected)
        app.buttons["All"].tap()
        XCTAssertTrue(app.buttons["All"].isSelected)
        capture("Polish Journal")
        app.buttons["Progress"].tap()
        if !app.buttons["Month"].isHittable { app.swipeUp() }
        app.buttons["Month"].tap()
        XCTAssertTrue(app.buttons["Month"].isSelected)
        app.buttons["Year"].tap()
        XCTAssertTrue(app.buttons["Year"].isSelected)
        capture("Polish Progress")
    }
    @MainActor func testEstimatedLevelIsRoundedAndLabelled() {
        let app = XCUIApplication()
        app.launchArguments = ["--uitest", "--reset-test-journal"]
        app.launch()
        XCTAssertEqual(app.staticTexts["liveMedicationAmount"].label, "0.00")
        XCTAssertTrue(app.staticTexts["Estimated level"].exists)
        XCTAssertFalse(app.staticTexts["Medication level"].exists)
        XCTAssertTrue(app.staticTexts["estimateDisclaimer"].exists)
        app.terminate()
        app.launchArguments = ["--uitest"]
        app.launch()
        XCTAssertEqual(app.staticTexts["liveMedicationAmount"].label, "0.00")
    }
    @MainActor func testDoseEntryIsMilligramsOnly() {
        let app = XCUIApplication()
        app.launchArguments = ["--demo", "--uitest"]
        app.launch()
        app.buttons["logDose"].tap()
        let field = app.textFields["doseAmount"]
        XCTAssertTrue(field.waitForExistence(timeout: 5))
        XCTAssertFalse(app.segmentedControls.buttons["Units"].exists)
        XCTAssertFalse(app.segmentedControls.buttons["mL"].exists)
        XCTAssertTrue(app.staticTexts["mg"].exists)
        app.buttons["Cancel"].tap()
        app.buttons["Settings"].tap()
        XCTAssertFalse(app.buttons["Dose entry"].exists)
        XCTAssertFalse(app.staticTexts["A space to talk"].exists)
    }
    @MainActor func testInjectionSidePreferenceSelectionAndEditsSurviveRelaunch() {
        let app = XCUIApplication()
        app.launchArguments = ["--uitest", "--reset-test-journal"]
        app.launch()
        XCTAssertTrue(app.buttons["logDose"].waitForExistence(timeout: 10))
        app.buttons["logDose"].tap()
        let picker = app.buttons["injectionSidePicker"]
        XCTAssertTrue(picker.waitForExistence(timeout: 5))
        XCTAssertEqual(picker.value as? String, "Right")
        app.buttons["Cancel"].tap()

        app.buttons["Settings"].tap()
        app.buttons["injectionStartSidePicker"].tap()
        app.buttons["Left"].tap()
        app.terminate()
        app.launchArguments = ["--uitest"]
        app.launch()
        XCTAssertTrue(app.buttons["logDose"].waitForExistence(timeout: 10))
        app.buttons["logDose"].tap()
        XCTAssertTrue(picker.waitForExistence(timeout: 5))
        XCTAssertEqual(picker.value as? String, "Left", "Start on persists before any dose has a side")

        // Override the suggestion, then verify both the saved side and next suggestion.
        picker.tap()
        app.buttons["Right"].tap()
        let amount = app.textFields["doseAmount"]
        amount.tap()
        amount.typeText("0.5")
        app.buttons["saveDose"].tap()
        XCTAssertTrue(app.buttons["logDose"].waitForExistence(timeout: 5))
        app.terminate()
        app.launch()
        app.buttons["Journal"].tap()
        let record = app.staticTexts["0.5 mg · Semaglutide"]
        XCTAssertTrue(record.waitForExistence(timeout: 5))
        record.tap()
        XCTAssertTrue(picker.waitForExistence(timeout: 5))
        XCTAssertEqual(picker.value as? String, "Right")
        picker.tap()
        app.buttons["Left"].tap()
        app.buttons["saveDose"].tap()
        XCTAssertTrue(record.waitForExistence(timeout: 5))
        app.terminate()
        app.launch()
        app.buttons["Journal"].tap()
        XCTAssertTrue(record.waitForExistence(timeout: 5))
        record.tap()
        XCTAssertTrue(picker.waitForExistence(timeout: 5))
        XCTAssertEqual(picker.value as? String, "Left", "Editing the side persists")
        app.buttons["Cancel"].tap()
        app.buttons["Home"].tap()
        app.buttons["logDose"].tap()
        XCTAssertTrue(picker.waitForExistence(timeout: 5))
        XCTAssertEqual(picker.value as? String, "Right", "Known history overrides Start on Left")
    }

    @MainActor func testEditingAnUnknownDoseKeepsItsSideUnknownUnlessChosen() {
        // Demo doses intentionally retain nil sides, like records from older app versions.
        let app = XCUIApplication()
        app.launchArguments = ["--demo", "--uitest"]
        app.launch()
        app.buttons["Journal"].tap()
        app.buttons["Doses"].tap()
        let record = app.staticTexts["Easy morning. Keeping water close today."]
        XCTAssertTrue(record.waitForExistence(timeout: 5))
        record.tap()
        let picker = app.buttons["injectionSidePicker"]
        XCTAssertTrue(picker.waitForExistence(timeout: 5))
        XCTAssertEqual(picker.value as? String, "Unknown")
        app.buttons["saveDose"].tap()
        XCTAssertTrue(record.waitForExistence(timeout: 5))
        record.tap()
        XCTAssertTrue(picker.waitForExistence(timeout: 5))
        XCTAssertEqual(picker.value as? String, "Unknown", "Saving an old dose must not invent a side")
        picker.tap()
        app.buttons["Left"].tap()
        app.buttons["saveDose"].tap()
        XCTAssertTrue(record.waitForExistence(timeout: 5))
        record.tap()
        XCTAssertTrue(picker.waitForExistence(timeout: 5))
        XCTAssertEqual(picker.value as? String, "Left")
        app.buttons["Cancel"].tap()
        app.buttons["Home"].tap()
        app.buttons["logDose"].tap()
        XCTAssertTrue(picker.waitForExistence(timeout: 5))
        XCTAssertEqual(picker.value as? String, "Right")
    }

    @MainActor func testReopeningKilogramWeightDoesNotConvertItAgain() {
        let app = XCUIApplication()
        app.launchArguments = ["--demo", "--uitest"]
        app.launch()
        app.buttons["Settings"].tap()
        app.buttons["Weight unit, lbs"].tap()
        app.buttons["kg"].tap()
        app.buttons["Journal"].tap()
        app.staticTexts["88.5 kg"].tap()
        XCTAssertEqual(app.textFields["weightAmount"].value as? String, "88.5")
    }
    @MainActor func testDoseAndWeightLogWithoutAVial() {
        let app = XCUIApplication()
        app.launchArguments = ["--uitest", "--reset-test-journal"]
        app.launch()
        XCTAssertTrue(app.buttons["logDose"].waitForExistence(timeout: 10))
        XCTAssertFalse(app.buttons["vialCard"].exists)
        XCTAssertFalse(app.staticTexts["Add vial"].exists)

        app.buttons["logDose"].tap()
        let dose = app.textFields["doseAmount"]
        XCTAssertTrue(dose.waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Vial'")).firstMatch.exists, "No vial row without a vial")
        XCTAssertFalse(app.staticTexts["No vial"].exists)
        dose.tap()
        dose.typeText("2.5")
        app.buttons["saveDose"].tap()
        XCTAssertTrue(app.buttons["logDose"].waitForExistence(timeout: 5))

        app.buttons["logWeight"].tap()
        let weight = app.textFields["weightAmount"]
        XCTAssertTrue(weight.waitForExistence(timeout: 5))
        weight.tap()
        weight.typeText("201.4")
        app.buttons["saveWeight"].tap()
        XCTAssertFalse(weight.waitForExistence(timeout: 2))

        app.buttons["Journal"].tap()
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH '2.5 mg'")).firstMatch.waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["201.4 lbs"].exists)

        // Vials stay reachable from Treatment.
        app.buttons["Treatment"].tap()
        XCTAssertTrue(app.buttons["Add Vial"].waitForExistence(timeout: 5))
    }
    @MainActor func testSettingsExplainsRowsWithInfoButtonsInsteadOfFooters() {
        let app = XCUIApplication()
        app.launchArguments = ["--demo", "--uitest"]
        app.launch()
        app.buttons["Settings"].tap()
        XCTAssertTrue(app.staticTexts["pageHeader-Settings"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.staticTexts["Read-only. Tendr never writes to Apple Health."].exists)
        XCTAssertFalse(app.staticTexts.containing(NSPredicate(format: "label BEGINSWITH 'Removes'")).firstMatch.exists)

        app.buttons["appleHealthInfo"].tap()
        let popover = app.staticTexts["infoPopover"]
        XCTAssertTrue(popover.waitForExistence(timeout: 5))
        XCTAssertTrue(popover.label.contains("Read-only"))
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.08)).tap()
        XCTAssertTrue(popover.waitForNonExistence(timeout: 5))

        app.buttons["firstDoseWeightsInfo"].tap()
        XCTAssertTrue(popover.waitForExistence(timeout: 5))
        XCTAssertTrue(popover.label.contains("first dose"))
    }
    @MainActor func testWeightTrendModeAppliesToProgress() {
        let app = XCUIApplication()
        app.launchArguments = ["--demo", "--uitest"]
        app.launch()
        app.buttons["Progress"].tap()
        let caption = app.staticTexts["weightTrendCaption"]
        for _ in 0..<3 where !caption.exists { app.swipeUp() }
        XCTAssertEqual(caption.label, "7-day average")

        app.buttons["Settings"].tap()
        app.buttons["Weight trend, 7-day average"].tap()
        XCTAssertTrue(app.buttons["Smoothed trend"].waitForExistence(timeout: 5))
        for title in ["Raw readings", "14-day average", "30-day average", "Weekly average"] { XCTAssertTrue(app.buttons[title].exists, title) }
        app.buttons["Smoothed trend"].tap()
        XCTAssertTrue(app.buttons["Weight trend, Smoothed trend"].waitForExistence(timeout: 5))

        app.buttons["Progress"].tap()
        for _ in 0..<3 where !caption.exists { app.swipeUp() }
        XCTAssertEqual(caption.label, "Smoothed trend")
    }
    @MainActor func testNotePlaceholderInvitesATap() {
        let app = XCUIApplication()
        app.launchArguments = ["--demo", "--uitest"]
        app.launch()
        app.buttons["Progress"].tap()
        app.buttons["Log weight"].tap()
        XCTAssertTrue(app.textFields["weightAmount"].waitForExistence(timeout: 5))
        let note = app.descendants(matching: .any)["noteField"]
        XCTAssertFalse(note.exists, "An empty note stays collapsed")
        app.buttons["Note"].tap()
        XCTAssertTrue(note.waitForExistence(timeout: 5))
        XCTAssertEqual(note.placeholderValue, "Tap to add a note…")
    }
    @MainActor func testNotesShowWhenTheyExist() {
        let app = XCUIApplication()
        app.launchArguments = ["--demo", "--uitest"]
        app.launch()
        app.buttons["Journal"].tap()
        let weightNote = "Feeling more like myself. A long walk this morning."
        let weightRow = app.staticTexts[weightNote]
        XCTAssertTrue(weightRow.waitForExistence(timeout: 5), "Journal rows show their note")
        weightRow.tap()
        let field = app.descendants(matching: .any)["noteField"]
        XCTAssertTrue(field.waitForExistence(timeout: 5), "An existing note opens expanded")
        XCTAssertEqual(field.value as? String, weightNote)
        app.buttons["Cancel"].tap()

        app.buttons["Doses"].tap()
        let doseNote = "Easy morning. Keeping water close today."
        XCTAssertTrue(app.staticTexts[doseNote].waitForExistence(timeout: 5))
        app.staticTexts[doseNote].tap()
        XCTAssertTrue(field.waitForExistence(timeout: 5))
        XCTAssertEqual(field.value as? String, doseNote)
    }
    @MainActor func testMedicationScrubResetsWhenThePageReappears() {
        let app = XCUIApplication()
        app.launchArguments = ["--demo", "--uitest"]
        app.launch()
        let homeChart = app.descendants(matching: .any).matching(identifier: "medicationChart").firstMatch
        XCTAssertTrue(homeChart.waitForExistence(timeout: 10))
        homeChart.coordinate(withNormalizedOffset: CGVector(dx: 0.85, dy: 0.5)).tap()
        let detailChart = app.descendants(matching: .any).matching(identifier: "medicationDetailChart").firstMatch
        XCTAssertTrue(detailChart.waitForExistence(timeout: 5))
        detailChart.coordinate(withNormalizedOffset: CGVector(dx: 0.72, dy: 0.5))
            .press(forDuration: 0.2, thenDragTo: detailChart.coordinate(withNormalizedOffset: CGVector(dx: 0.4, dy: 0.5)))
        XCTAssertTrue(app.buttons["Live"].waitForExistence(timeout: 3), "Scrubbing selects a past time")

        app.buttons["Progress"].tap()
        XCTAssertTrue(app.staticTexts["pageHeader-Progress"].waitForExistence(timeout: 5))
        app.buttons["Home"].tap()
        XCTAssertTrue(detailChart.waitForExistence(timeout: 5), "Returning to Home keeps the Medication page open")
        XCTAssertFalse(app.buttons["Live"].waitForExistence(timeout: 2), "The graph is back at now, not the old scrub position")
    }
    @MainActor func testWeightSavesWithKeyboardOpenAndSurvivesRelaunch() {
        let app = XCUIApplication()
        app.launchArguments = ["--uitest", "--reset-test-journal"]
        app.launch()
        app.buttons["Progress"].tap()
        app.buttons["Log weight"].tap()
        let field = app.textFields["weightAmount"]
        XCTAssertTrue(field.waitForExistence(timeout: 5))
        field.tap()
        field.typeText("200.3")
        XCTAssertTrue(app.buttons["saveWeight"].isHittable, "Save must remain reachable above the keyboard")
        app.buttons["saveWeight"].tap()
        XCTAssertFalse(field.waitForExistence(timeout: 1))
        app.terminate()
        app.launchArguments = ["--uitest"]
        app.launch()
        app.buttons["Journal"].tap()
        XCTAssertTrue(app.staticTexts["200.3 lbs"].waitForExistence(timeout: 5))
        app.staticTexts["200.3 lbs"].tap()
        XCTAssertEqual(app.textFields["weightAmount"].value as? String, "200.3")
    }
    @MainActor func testLogDoseOnlyCreatesTakenDoses() {
        let app = XCUIApplication()
        app.launchArguments = ["--uitest", "--reset-test-journal"]
        app.launch()
        app.buttons["logDose"].tap()
        let field = app.textFields["doseAmount"]
        XCTAssertTrue(field.waitForExistence(timeout: 5))
        field.tap()
        field.typeText("0.5")
        app.buttons["saveDose"].tap()
        XCTAssertTrue(app.buttons["logDose"].waitForExistence(timeout: 3))
        app.buttons["Journal"].tap()
        let record = app.staticTexts["0.5 mg · Semaglutide"]
        XCTAssertTrue(record.waitForExistence(timeout: 5))
        app.terminate()
        app.launchArguments = ["--uitest"]
        app.launch()
        app.buttons["Journal"].tap()
        XCTAssertTrue(app.staticTexts["0.5 mg · Semaglutide"].waitForExistence(timeout: 5))
    }
    @MainActor func testEveryFewDaysScheduleCanBeSaved() {
        let app = XCUIApplication()
        app.launchArguments = ["--uitest", "--reset-test-journal"]
        app.launch()
        app.buttons["Treatment"].tap()
        app.buttons["editSchedule"].tap()
        app.segmentedControls.buttons["Every few days"].tap()
        XCTAssertTrue(app.staticTexts["Every 4 days"].exists)
        XCTAssertTrue(app.staticTexts["Starts"].exists)
        app.buttons["Save"].tap()
        XCTAssertTrue(app.staticTexts["Every 4 days"].waitForExistence(timeout: 5))
    }
    @MainActor func testReminderTimeIsConditionalWithoutPreview() {
        let app = XCUIApplication()
        app.launchArguments = ["--uitest", "--reset-test-journal"]
        app.launch()
        app.buttons["Treatment"].tap()
        app.buttons["editSchedule"].tap()
        XCTAssertFalse(app.staticTexts["Time"].exists)
        XCTAssertFalse(app.buttons["Send test notification"].exists)
        app.switches["Remind me"].switches.firstMatch.tap()
        XCTAssertTrue(app.staticTexts["Time"].waitForExistence(timeout: 3))
        XCTAssertFalse(app.staticTexts["Notification preview"].exists)
        XCTAssertFalse(app.buttons["Send test notification"].exists)
    }
    @MainActor func testHomeCardsOpenTheirOwnScreens() {
        let app = XCUIApplication()
        app.launchArguments = ["--demo", "--uitest"]
        app.launch()
        // The whole medication card is the tap target, not only its chart.
        let medicationCard = app.descendants(matching: .any).matching(identifier: "medicationCard").firstMatch
        XCTAssertTrue(medicationCard.waitForExistence(timeout: 5))
        medicationCard.tap()
        XCTAssertTrue(app.descendants(matching: .any).matching(identifier: "medicationDetailChart").firstMatch.waitForExistence(timeout: 5))
        app.navigationBars.buttons.element(boundBy: 0).tap()

        // The weight tile moves to the Progress tab rather than opening a sheet.
        app.swipeUp()
        app.descendants(matching: .any).matching(identifier: "weightCard").firstMatch.tap()
        XCTAssertTrue(app.staticTexts["pageHeader-Progress"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["Done"].exists)
        app.buttons["Home"].tap()
        XCTAssertTrue(app.buttons["logDose"].waitForExistence(timeout: 5))
    }
    @MainActor func testDoseHistoryCardShowsThreeAndOpensFilteredJournal() {
        let app = XCUIApplication()
        app.launchArguments = ["--demo", "--uitest"]
        app.launch()
        app.buttons["Treatment"].tap()

        let card = app.buttons["doseHistoryCard"]
        for _ in 0..<3 where !card.isHittable { app.swipeUp() }
        XCTAssertTrue(card.waitForExistence(timeout: 5))
        app.swipeUp()
        XCTAssertEqual(card.staticTexts.matching(identifier: "0.5 mg").count, 3)
        XCTAssertTrue(card.staticTexts["+5 more"].exists)
        XCTAssertFalse(card.staticTexts["+5 more mg"].exists)
        capture("Treatment dose history")

        card.tap()
        XCTAssertTrue(app.staticTexts["pageHeader-Journal"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["Doses"].isSelected)
        XCTAssertFalse(app.buttons["Weight"].isSelected)
    }
    @MainActor func testMedicationChartTapAndFutureDrag() {
        let app = XCUIApplication()
        app.launchArguments = ["--demo", "--uitest"]
        app.launch()

        let homeChart = app.descendants(matching: .any).matching(identifier: "medicationChart").firstMatch
        XCTAssertTrue(homeChart.waitForExistence(timeout: 10))
        XCTAssertFalse(app.staticTexts.containing(NSPredicate(format: "label BEGINSWITH 'Dashed line includes'")).firstMatch.exists)
        capture("Medication Home")
        homeChart.coordinate(withNormalizedOffset: CGVector(dx: 0.85, dy: 0.5)).tap()
        let detailChart = app.descendants(matching: .any).matching(identifier: "medicationDetailChart").firstMatch
        XCTAssertTrue(detailChart.waitForExistence(timeout: 5), "Tapping the plotted line should open Medication")

        let amount = app.staticTexts["liveMedicationAmount"]
        let number = NumberFormatter()
        number.numberStyle = .decimal
        guard let current = number.number(from: amount.label)?.doubleValue else { XCTFail("Expected a numeric live estimate"); return }
        let start = detailChart.coordinate(withNormalizedOffset: CGVector(dx: 0.72, dy: 0.5))
        let future = detailChart.coordinate(withNormalizedOffset: CGVector(dx: 0.9, dy: 0.5))
        start.press(forDuration: 0.2, thenDragTo: future)
        XCTAssertTrue(app.buttons["Live"].exists, "The future selection should remain visible after the drag")
        guard let futureAmount = number.number(from: amount.label)?.doubleValue else { XCTFail("Expected a numeric future estimate"); return }
        XCTAssertGreaterThan(futureAmount, current + 0.1, "The readout should include scheduled future doses shown by the curve")
        capture("Medication future selection")
        app.buttons["Live"].tap()
        XCTAssertFalse(app.buttons["Live"].exists)
        app.navigationBars.buttons.element(boundBy: 0).tap()
        app.buttons["About medication estimates"].tap()
        XCTAssertTrue(app.navigationBars["About this graph"].waitForExistence(timeout: 5))
    }
    @MainActor func testWeightCardTapTargets() {
        let app = XCUIApplication()
        app.launchArguments = ["--demo", "--uitest"]
        app.launch()
        app.swipeUp()
        capture("Weight Home")

        for point in [CGVector(dx: 0.15, dy: 0.15), CGVector(dx: 0.18, dy: 0.5), CGVector(dx: 0.8, dy: 0.5), CGVector(dx: 0.5, dy: 0.9)] {
            let card = app.descendants(matching: .any).matching(identifier: "weightCard").firstMatch
            XCTAssertTrue(card.waitForExistence(timeout: 5))
            card.coordinate(withNormalizedOffset: point).tap()
            XCTAssertTrue(app.staticTexts["pageHeader-Progress"].waitForExistence(timeout: 5), "Weight card tap at \(point) should open Progress")
            app.buttons["Home"].tap()
        }

        app.buttons["logWeight"].tap()
        XCTAssertTrue(app.textFields["weightAmount"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.staticTexts["pageHeader-Progress"].exists)
        app.buttons["Cancel"].tap()
        XCTAssertGreaterThanOrEqual(app.buttons["logWeight"].frame.width, 50)

        app.buttons["Progress"].tap()
        let currentWeight = app.descendants(matching: .any).matching(identifier: "currentWeightCard").firstMatch
        XCTAssertTrue(currentWeight.waitForExistence(timeout: 5))
        XCTAssertFalse(app.staticTexts["Latest recorded weight"].exists)
        XCTAssertTrue(app.staticTexts["195.1"].exists)
        XCTAssertTrue(app.staticTexts["WEIGHT TREND"].exists)
        XCTAssertTrue(app.staticTexts["7-day average"].exists)
        let goalDate = Calendar.current.date(byAdding: .day, value: 60, to: Calendar.current.startOfDay(for: Date()))!
        XCTAssertFalse(app.staticTexts[goalDate.formatted(.dateTime.month(.abbreviated).day().year())].exists)
        Thread.sleep(forTimeInterval: 1)
        capture("Weight Progress Top")
        let addWeight = app.buttons["Log weight"]
        XCTAssertGreaterThanOrEqual(addWeight.frame.width, 50)
        addWeight.tap()
        XCTAssertTrue(app.textFields["weightAmount"].waitForExistence(timeout: 5))
        app.buttons["Cancel"].tap()
        app.swipeUp()
        app.swipeUp()
        app.swipeUp()
        Thread.sleep(forTimeInterval: 1)
        capture("Weight Progress Chart")
    }
    @MainActor func testCustomDatesCanBeChosenAndTheScheduleCleared() {
        let app = XCUIApplication()
        app.launchArguments = ["--demo", "--uitest"]
        app.launch()
        app.buttons["Treatment"].tap()
        app.buttons["editSchedule"].tap()
        app.segmentedControls.buttons["Custom"].tap()
        let picker = app.descendants(matching: .any).matching(identifier: "customDatePicker").firstMatch
        XCTAssertTrue(picker.waitForExistence(timeout: 5))
        // Pick two days from the visible month grid.
        let days = picker.buttons.allElementsBoundByIndex.filter { $0.isHittable }
        XCTAssertGreaterThan(days.count, 2, "The calendar should offer selectable days")
        days[days.count - 1].tap()
        days[days.count - 2].tap()
        XCTAssertTrue(app.staticTexts["Upcoming"].waitForExistence(timeout: 3))
        capture("schedule-custom")
        app.buttons["Save"].tap()
        // Wait for the sheet to finish dismissing before reopening it.
        XCTAssertTrue(app.navigationBars["Your schedule"].waitForNonExistence(timeout: 5))
        XCTAssertTrue(app.buttons["editSchedule"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts.containing(NSPredicate(format: "label BEGINSWITH 'Custom ·'")).firstMatch.exists)
        capture("treatment-custom")

        // Clearing leaves no schedule at all.
        app.buttons["editSchedule"].tap()
        XCTAssertTrue(app.navigationBars["Your schedule"].waitForExistence(timeout: 5))
        // Form rows are lazy, so scroll the calendar past before looking for the clear action.
        let clear = app.buttons["clearSchedule"]
        for _ in 0..<6 where !clear.exists { app.swipeUp() }
        XCTAssertTrue(clear.waitForExistence(timeout: 5))
        clear.tap()
        app.alerts.buttons["Clear"].tap()
        XCTAssertTrue(app.staticTexts["No schedule set"].waitForExistence(timeout: 5))
        capture("treatment-cleared")
    }
    @MainActor func testNewDoseHidesVialAdditionAndMedicationHeaderButEditingShowsThem() {
        let app = XCUIApplication()
        app.launchArguments = ["--demo", "--uitest"]
        app.launch()
        app.buttons["logDose"].tap()
        XCTAssertTrue(app.textFields["doseAmount"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["Add a vial"].exists)
        XCTAssertFalse(app.staticTexts["Weekly medication"].exists)
        capture("New dose")
        app.buttons["Cancel"].tap()

        app.buttons["Journal"].tap()
        let record = app.staticTexts.matching(NSPredicate(format: "label CONTAINS 'Weekly medication'")).firstMatch
        XCTAssertTrue(record.waitForExistence(timeout: 5))
        record.tap()
        XCTAssertTrue(app.staticTexts["Weekly medication"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["Add a vial"].exists)
        capture("Edit dose")
    }
    @MainActor private func capture(_ name: String) {
        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = name; attachment.lifetime = .keepAlways
        add(attachment)
    }
}
