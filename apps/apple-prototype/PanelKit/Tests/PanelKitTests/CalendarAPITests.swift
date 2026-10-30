import Foundation
import Testing
@testable import PanelKit

private actor CalendarStoreStub: CalendarEventStore {
    var access: CalendarAccess
    let grants: Bool
    let revokeAfterRead: Bool
    let values: [CalendarEvent]
    private(set) var requests = 0
    private(set) var reads: [DateInterval] = []

    init(access: CalendarAccess, grants: Bool = true, revokeAfterRead: Bool = false, values: [CalendarEvent] = []) {
        self.access = access; self.grants = grants; self.revokeAfterRead = revokeAfterRead; self.values = values
    }
    func authorization() -> CalendarAccess { access }
    func requestFullAccess() -> Bool {
        requests += 1
        access = grants ? .fullAccess : .denied
        return grants
    }
    func events(in interval: DateInterval) -> [CalendarEvent] {
        reads.append(interval)
        if revokeAfterRead { access = .denied }
        return values
    }
}

private let calendarInterval = DateInterval(start: Date(timeIntervalSince1970: 1793343600), duration: 604800)

@Test func calendarFixturesPreserveDatesAndOccurrenceIdentity() async throws {
    let url = try #require(Bundle.module.url(forResource: "events", withExtension: "json", subdirectory: "Fixtures/calendar"))
    let decoder = JSONDecoder(); decoder.dateDecodingStrategy = .iso8601
    let values = try decoder.decode([CalendarEvent].self, from: Data(contentsOf: url))
    #expect(values.count == 7)
    #expect(Set(values.map(\.id)).count == 7)
    #expect(values.filter { $0.id.hasPrefix("fixture_series@") }.count == 2)
    #expect(values.contains { $0.isAllDay && $0.location == nil })
    let store = CalendarStoreStub(access: .fullAccess, values: values)
    let api = CalendarAPI(store: store)
    #expect(try await api.events(in: calendarInterval) == values)
    #expect(await store.reads == [calendarInterval])
    #expect(await store.requests == 0)
}

@Test func calendarPromptsOnlyWhenUndeterminedAndOnlyOnce() async throws {
    let store = CalendarStoreStub(access: .notDetermined)
    let api = CalendarAPI(store: store)
    #expect(await store.requests == 0)
    _ = try await api.events(in: calendarInterval)
    _ = try await api.events(in: calendarInterval)
    #expect(await store.requests == 1)
    #expect(await store.reads.count == 2)
}

@Test(arguments: [CalendarAccess.denied, .restricted, .writeOnly])
func calendarCannotReadWithoutFullAccess(_ access: CalendarAccess) async {
    let store = CalendarStoreStub(access: access)
    await #expect(throws: CalendarAPIError.self) { try await CalendarAPI(store: store).events(in: calendarInterval) }
    #expect(await store.requests == 0)
    #expect(await store.reads.isEmpty)
}

@Test func calendarDeniedPromptAndRevocationFailClosed() async {
    let denied = CalendarStoreStub(access: .notDetermined, grants: false)
    let api = CalendarAPI(store: denied)
    for _ in 0..<2 {
        await #expect(throws: CalendarAPIError.self) { try await api.events(in: calendarInterval) }
    }
    #expect(await denied.requests == 1)
    #expect(await denied.reads.isEmpty)
    let revoked = CalendarStoreStub(access: .fullAccess, revokeAfterRead: true)
    await #expect(throws: CalendarAPIError.self) { try await CalendarAPI(store: revoked).events(in: calendarInterval) }
}

@Test func calendarCancellationDoesNotRequestPermission() async {
    let store = CalendarStoreStub(access: .notDetermined)
    let task = Task {
        withUnsafeCurrentTask { $0?.cancel() }
        await #expect(throws: CancellationError.self) { try await CalendarAPI(store: store).events(in: calendarInterval) }
    }
    await task.value
    #expect(await store.requests == 0)
    #expect(await store.reads.isEmpty)
}
