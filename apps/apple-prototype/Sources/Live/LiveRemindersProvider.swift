import Foundation
import Observation
import PanelKit

@MainActor protocol RemindersProvider: AnyObject, Observable {
    var items: [PanelReminder] { get }
    var availability: LiveAvailability { get }
    var busy: Bool { get }
    func refresh() async
    func complete(id: String) async
    func add(title: String) async
}

@MainActor @Observable final class LiveRemindersProvider: RemindersProvider {
    private(set) var items: [PanelReminder] = []
    private(set) var availability: LiveAvailability = .loading
    private(set) var busy = false
    @ObservationIgnored private let api: any RemindersServing
    init(api: any RemindersServing = RemindersAPI()) { self.api = api }

    func refresh() async { await perform { } }
    func complete(id: String) async {
        guard items.contains(where: { $0.id == id && $0.writable }) else { return }
        await perform { try await self.api.complete(id: id) }
    }
    func add(title: String) async {
        let title = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !title.isEmpty else { return }
        await perform { try await self.api.add(title: title) }
    }
    private func perform(_ write: () async throws -> Void) async {
        guard !busy else { return }
        busy = true
        defer { busy = false }
        do {
            try Task.checkCancellation()
            try await write()
            let snapshot = try await api.list()
            try Task.checkCancellation()
            items = snapshot
            availability = .live
        } catch {
            items = []
            availability = .unavailable("Reminders are unavailable.")
        }
    }
}

@MainActor @Observable final class MockRemindersProvider: RemindersProvider {
    var items: [PanelReminder]
    var availability: LiveAvailability = .live
    let busy = false
    init(items: [PanelReminder] = []) { self.items = items }
    func refresh() async {}
    func complete(id: String) async { items.removeAll { $0.id == id } }
    func add(title: String) async {} // Preview source never writes to EventKit.
}
