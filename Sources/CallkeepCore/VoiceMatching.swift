import Foundation

public enum VoiceMatching {
    /// Compare normalized voice vectors. Invalid, empty, or mismatched vectors cannot match.
    public static func similarity(_ lhs: [Float], _ rhs: [Float]) -> Double? {
        guard !lhs.isEmpty, lhs.count == rhs.count else { return nil }
        var dot = 0.0, left = 0.0, right = 0.0
        for (a, b) in zip(lhs, rhs) {
            guard a.isFinite, b.isFinite else { return nil }
            let x = Double(a), y = Double(b)
            dot += x * y; left += x * x; right += y * y
        }
        guard left > 0, right > 0 else { return nil }
        return max(-1, min(1, dot / sqrt(left * right)))
    }
    /// Only offer a clearly separated candidate; all candidates still require confirmation.
    public static func candidate(for vector: [Float], profiles: [(id: UUID, vector: [Float])]) -> UUID? {
        let ranked = profiles.compactMap { profile in similarity(vector, profile.vector).map { (profile.id, $0) } }
            .sorted { $0.1 > $1.1 }
        guard let first = ranked.first, first.1 >= 0.8,
              ranked.count < 2 || first.1 - ranked[1].1 >= 0.08 else { return nil }
        return first.0
    }
}
