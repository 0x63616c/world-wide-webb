import Foundation
import Observation
import PanelKit

struct NotificationItem: Identifiable, Equatable, Codable, Sendable {
    let id: String
    let sourceModule: String
    let title: String
    let body: String
    let deepLink: String
    let priority: NotificationPriority
    let dedupeKey: String?
    let createdAt: Date
    var readAt: Date?
    let remote: Bool

    init(_ row: PanelNotification) {
        id = row.id; sourceModule = row.sourceModule; title = row.title; body = row.body
        deepLink = row.deepLink; priority = row.priority; dedupeKey = row.dedupeKey
        createdAt = row.createdAt; readAt = row.readAt; remote = true
    }

    init(id: String, sourceModule: String, title: String, body: String, deepLink: String,
         priority: NotificationPriority, dedupeKey: String?, createdAt: Date) {
        self.id = id; self.sourceModule = sourceModule; self.title = title; self.body = body
        self.deepLink = deepLink; self.priority = priority; self.dedupeKey = dedupeKey
        self.createdAt = createdAt; readAt = nil; remote = false
    }
}

struct NotificationGroup: Identifiable, Equatable {
    let sourceModule: String
    let items: [NotificationItem]
    var id: String { sourceModule }
}

/// One root-owned inbox for local producers and the backend; cached history never replays banners.
/// Banner timeout only hides presentation. Explicit dismiss/clear changes history.
@MainActor @Observable final class NotificationCenter {
    enum Connection: Equatable { case localOnly, connected, unavailable }
    private(set) var connection: Connection = .localOnly
    private(set) var lastError: String?
    private(set) var arrivalFeedback = 0
    private(set) var dismissFeedback = 0
    private(set) var openFeedback = 0
    var historyPresented = false
    private(set) var cacheError: String?
    private(set) var cursor: String?
    private var items: [String: NotificationItem] = [:]
    private var banners: Set<String> = []
    @ObservationIgnored private var remaining: [String: TimeInterval] = [:]
    @ObservationIgnored private var pausedSources: Set<String> = []
    @ObservationIgnored private var revisions: [String: Int64] = [:]
    @ObservationIgnored private var refreshing = false
    @ObservationIgnored private var openHandler: ((NotificationItem) -> Bool)?
    private var presenters: [UUID] = []
    @ObservationIgnored private var lastSync: Date?
    @ObservationIgnored private let api: (any NotificationsServing)?
    @ObservationIgnored private let now: () -> Date
    @ObservationIgnored private let cache: (any NotificationHistoryCaching)?

    init(api: (any NotificationsServing)? = nil, cache: (any NotificationHistoryCaching)? = nil,
         now: @escaping () -> Date = Date.init) {
        self.api = api; self.cache = cache; self.now = now
        do {
            if let saved = try cache?.load(), saved.version == 1 {
                items = Dictionary(saved.items.map { ($0.id, $0) }, uniquingKeysWith: { _, latest in latest })
                revisions = saved.revisions
                cursor = saved.cursor
                lastSync = saved.lastSync
            }
        } catch { cacheError = "Saved notifications couldn’t be loaded. Server history will refresh when connected." }
    }

    private func persist() {
        guard let cache else { return }
        do {
            try cache.save(NotificationHistorySnapshot(items: history, revisions: revisions, cursor: cursor, lastSync: lastSync))
            cacheError = nil
        } catch { cacheError = "Notifications couldn’t be saved on this device. Try freeing storage space." }
    }

    var history: [NotificationItem] { items.values.sorted(by: Self.ordered) }
    var groups: [NotificationGroup] { group(history) }
    var unreadCount: Int { items.values.filter { $0.readAt == nil }.count }
    var bannerGroups: [NotificationGroup] { group(banners.compactMap { items[$0] }.sorted(by: Self.ordered)) }

    @discardableResult
    func post(sourceModule: String, title: String, body: String, deepLink: String,
              priority: NotificationPriority = .normal, dedupeKey: String? = nil) -> String {
        let existing = match(source: sourceModule, key: dedupeKey)
        // Local notifications never impersonate server IDs or mutate server records.
        let id = existing.flatMap { $0.remote ? nil : $0.id } ?? UUID().uuidString
        if let existing { remove(existing.id) }
        items[id] = NotificationItem(id: id, sourceModule: sourceModule, title: title, body: body,
            deepLink: deepLink, priority: priority, dedupeKey: dedupeKey, createdAt: now())
        present(id)
        persist()
        return id
    }

    func refresh() async {
        guard let api, !refreshing else { return }
        refreshing = true
        defer { refreshing = false }
        // Tombstones expire after 30 days. Never resume a cursor older than retention.
        let reset = lastSync.map { now().timeIntervalSince($0) >= 30 * 86_400 } ?? false
        var next = reset ? nil : cursor
        var first = true
        do {
            repeat {
                let page = try await api.list(since: next)
                try Task.checkCancellation()
                if first && reset {
                    for item in history where item.remote { remove(item.id) }
                    revisions.removeAll()
                }
                first = false
                for row in page.items { merge(row) }
                cursor = page.cursor
                lastSync = now()
                persist()
                connection = .connected
                if !page.hasMore { break }
                guard page.cursor != next else { throw PanelAPIError.decoding("Notification cursor did not advance.") }
                next = page.cursor
            } while !Task.isCancelled
        } catch is CancellationError {
            return
        } catch {
            if !Task.isCancelled { connection = .unavailable }
        }
    }

    /// The root's scene task owns cancellation; retry missing/older servers without blocking local posts.
    func run() async {
        guard api != nil else { return }
        while !Task.isCancelled {
            await refresh()
            do { try await Task.sleep(for: .seconds(connection == .unavailable ? 30 : 5)) }
            catch { return }
        }
    }

    func markRead(_ id: String) async {
        guard let item = items[id] else { return }
        do {
            if item.remote, let api { merge(try await api.markRead(id: id)) }
            else { items[id]?.readAt = now() }
            persist()
            lastError = nil
        } catch { lastError = "Couldn’t mark the notification as read. Try again." }
    }

    func setOpenHandler(_ handler: @escaping (NotificationItem) -> Bool) { openHandler = handler }

    func registerPresenter(_ id: UUID) {
        presenters.removeAll { $0 == id }
        presenters.append(id)
        pausedSources.removeAll()
    }

    func unregisterPresenter(_ id: UUID) {
        if isActivePresenter(id) { pausedSources.removeAll() }
        presenters.removeAll { $0 == id }
    }

    func isActivePresenter(_ id: UUID) -> Bool { presenters.last == id }

    func open(_ id: String) async {
        guard let item = items[id], openHandler?(item) != false else { return }
        historyPresented = false
        hideBanner(id)
        openFeedback += 1
        await markRead(id)
    }

    func dismiss(_ id: String) async {
        guard let item = items[id] else { return }
        hideBanner(id)
        dismissFeedback += 1
        do {
            if item.remote, let api { merge(try await api.dismiss(id: id)) }
            else { remove(id) }
            persist()
            lastError = nil
        } catch {
            lastError = "Couldn’t dismiss the notification. Try again."
            if items[id] != nil { present(id, feedback: false) }
        }
    }

    /// WWW-60 can clear the inbox or one source without owning a second store.
    func clear(sourceModule: String? = nil) async {
        if let sourceModule {
            var failed = false
            for item in history where item.sourceModule == sourceModule {
                await dismiss(item.id)
                if lastError != nil { failed = true }
            }
            if failed { lastError = "Some notifications couldn’t be cleared. Try again." }
            return
        }
        let snapshot = history
        do {
            if snapshot.contains(where: \.remote), let api { _ = try await api.dismissAll() }
            // A local post arriving during the request must not be lost.
            for item in snapshot where items[item.id] == item { remove(item.id) }
            dismissFeedback += 1
            persist()
            lastError = nil
        } catch { lastError = "Couldn’t clear notifications. Try again." }
    }

    func setTouched(_ source: String, _ touched: Bool) {
        if touched { pausedSources.insert(source) } else { pausedSources.remove(source) }
    }

    /// Advance only banners actually on screen. Queued/covered banners get their full reading time.
    func advanceBanners(by elapsed: TimeInterval, visibleSources: Set<String>, paused: Bool = false) {
        guard !historyPresented, !paused, elapsed > 0, elapsed.isFinite else { return }
        for group in bannerGroups where visibleSources.contains(group.id) && !pausedSources.contains(group.id) {
            guard let item = group.items.first, let seconds = remaining[item.id] else { continue }
            if seconds <= elapsed { hideBanner(item.id) }
            else { remaining[item.id] = seconds - elapsed }
        }
    }

    func hideBanner(_ id: String) {
        banners.remove(id)
        remaining.removeValue(forKey: id)
    }

    private func merge(_ row: PanelNotification) {
        let revision = Int64(row.revision) ?? 0
        guard revision > (revisions[row.id] ?? -1) else { return }
        revisions[row.id] = revision
        if row.dismissedAt != nil { remove(row.id); return }
        let previous = items[row.id] ?? match(source: row.sourceModule, key: row.dedupeKey)
        let wasPresented = previous.map { banners.contains($0.id) } ?? false
        let duplicateLocal = previous.map {
            !$0.remote && $0.title == row.title && $0.body == row.body && $0.deepLink == row.deepLink
                && $0.priority == row.priority
        } ?? false
        let oldRemaining = previous.flatMap { remaining[$0.id] }
        if let previous, previous.id != row.id { remove(previous.id) }
        items[row.id] = NotificationItem(row)
        if row.readAt != nil { hideBanner(row.id) }
        else if duplicateLocal {
            if wasPresented {
                banners.insert(row.id)
                remaining[row.id] = oldRemaining
            }
        } else if previous == nil || previous.map({
            row.createdAt > $0.createdAt || row.title != $0.title || row.body != $0.body
                || row.deepLink != $0.deepLink || row.priority != $0.priority || $0.readAt != nil
        }) == true {
            present(row.id)
        }
    }

    private func present(_ id: String, feedback: Bool = true) {
        guard let item = items[id] else { return }
        banners.insert(id)
        remaining[id] = item.priority.bannerDuration
        if feedback { arrivalFeedback += 1 }
    }

    private func remove(_ id: String) { items.removeValue(forKey: id); hideBanner(id) }

    private func match(source: String, key: String?) -> NotificationItem? {
        guard let key else { return nil }
        return items.values.first { $0.sourceModule == source && $0.dedupeKey == key }
    }

    private func group(_ sorted: [NotificationItem]) -> [NotificationGroup] {
        var sources: [String] = []
        var grouped: [String: [NotificationItem]] = [:]
        for item in sorted {
            if grouped[item.sourceModule] == nil { sources.append(item.sourceModule) }
            grouped[item.sourceModule, default: []].append(item)
        }
        return sources.map { NotificationGroup(sourceModule: $0, items: grouped[$0]!) }
    }

    private static func ordered(_ a: NotificationItem, _ b: NotificationItem) -> Bool {
        if a.priority != b.priority { return a.priority.rank > b.priority.rank }
        if a.createdAt != b.createdAt { return a.createdAt > b.createdAt }
        return a.id < b.id
    }
}
