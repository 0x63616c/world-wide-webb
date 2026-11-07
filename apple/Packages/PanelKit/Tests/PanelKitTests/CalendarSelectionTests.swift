import Foundation
import Testing
@testable import PanelKit

@Test func calendarSelectionPersistsAndIncludesNewCalendars() async throws {
    let suite = "CalendarSelectionTests.\(UUID().uuidString)"
    let defaults = try #require(UserDefaults(suiteName: suite))
    defer { defaults.removePersistentDomain(forName: suite) }
    let selection = CalendarSelection(suiteName: suite)
    #expect(await selection.selected(from: ["work", "personal"]) == ["work", "personal"])
    await selection.setShown(false, identifier: "work")
    let relaunched = CalendarSelection(suiteName: suite)
    #expect(await relaunched.selected(from: ["work", "personal", "new"]) == ["personal", "new"])
    #expect(Set(defaults.stringArray(forKey: "Panel.Calendar.selectedIdentifiers") ?? []) == ["personal", "new"])
    await relaunched.setShown(false, identifier: "personal")
    await relaunched.setShown(false, identifier: "new")
    #expect(await relaunched.selected(from: ["work", "personal", "new"]).isEmpty)
    // A temporarily removed account must retain its explicit hidden choice.
    #expect(await relaunched.selected(from: ["personal"]).isEmpty)
    #expect(await relaunched.selected(from: ["work", "personal"]).isEmpty)
    await relaunched.showAll()
    #expect(await relaunched.selected(from: ["work", "personal", "new"]) == ["work", "personal", "new"])
}
