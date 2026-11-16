import Foundation

/// One event's place in a day timeline: minutes from midnight, and which of the
/// side-by-side columns it takes among the events it overlaps.
struct DayTimelineSlot: Equatable, Identifiable {
    let id: String
    let start: Int
    let end: Int
    let column: Int
    let columns: Int
}

enum DayTimeline {
    /// Packs overlapping spans into columns, like the system day view. A span
    /// shorter than `minimum` still reserves that much room so its title fits.
    static func slots(_ spans: [(id: String, start: Int, end: Int)], minimum: Int = 30) -> [DayTimelineSlot] {
        let padded = spans.map { (id: $0.id, start: $0.start, end: max($0.end, $0.start + minimum)) }
        let sorted = padded.sorted { lhs, rhs in
            if lhs.start != rhs.start { return lhs.start < rhs.start }
            if lhs.end != rhs.end { return lhs.end > rhs.end }
            return lhs.id < rhs.id
        }
        var result: [DayTimelineSlot] = []
        var cluster: [(id: String, start: Int, end: Int, column: Int)] = []
        var columnEnds: [Int] = []
        func flush() {
            result += cluster.map {
                DayTimelineSlot(id: $0.id, start: $0.start, end: $0.end, column: $0.column, columns: columnEnds.count)
            }
            cluster = []
            columnEnds = []
        }
        for span in sorted {
            if let latest = columnEnds.max(), span.start >= latest { flush() }
            let column = columnEnds.firstIndex { $0 <= span.start } ?? columnEnds.count
            if column == columnEnds.count { columnEnds.append(span.end) } else { columnEnds[column] = span.end }
            cluster.append((span.id, span.start, span.end, column))
        }
        flush()
        return result
    }
}
