import Foundation

/// Remember both known and selected IDs: an unseen calendar is shown by default,
/// while an explicitly hidden calendar stays hidden across relaunches.
public actor CalendarSelection {
    private let defaults: UserDefaults
    private let knownKey = "Panel.Calendar.knownIdentifiers"
    private let selectedKey = "Panel.Calendar.selectedIdentifiers"

    public init(suiteName: String? = nil) {
        defaults = suiteName.flatMap { UserDefaults(suiteName: $0) } ?? .standard
    }

    public func selected(from identifiers: Set<String>) -> Set<String> {
        let known = Set(defaults.stringArray(forKey: knownKey) ?? [])
        var selected = Set(defaults.stringArray(forKey: selectedKey) ?? [])
        let discovered = identifiers.subtracting(known)
        selected.formUnion(discovered)
        if !discovered.isEmpty {
            defaults.set(known.union(identifiers).sorted(), forKey: knownKey)
            defaults.set(selected.sorted(), forKey: selectedKey)
        }
        return selected.intersection(identifiers)
    }

    public func setShown(_ shown: Bool, identifier: String) {
        var selected = self.selected(from: [identifier])
        if shown { selected.insert(identifier) } else { selected.remove(identifier) }
        var saved = Set(defaults.stringArray(forKey: selectedKey) ?? [])
        saved.subtract([identifier]); saved.formUnion(selected)
        defaults.set(saved.sorted(), forKey: selectedKey)
    }

    public func showAll() {
        defaults.removeObject(forKey: knownKey)
        defaults.removeObject(forKey: selectedKey)
    }
}

public struct CalendarInfo: Identifiable, Sendable, Equatable {
    public let id: String
    public let title: String
    public let sourceID: String
    public let sourceTitle: String
    public let red: Double
    public let green: Double
    public let blue: Double

    public init(id: String, title: String, sourceID: String, sourceTitle: String,
                red: Double, green: Double, blue: Double) {
        self.id = id; self.title = title; self.sourceID = sourceID; self.sourceTitle = sourceTitle
        self.red = red; self.green = green; self.blue = blue
    }
}
