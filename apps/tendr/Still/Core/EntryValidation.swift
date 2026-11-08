import Foundation

public enum EntryValidation {
    public static func number(_ text: String, locale: Locale = .current) -> Double? {
        let normalized = text.trimmingCharacters(in: .whitespacesAndNewlines).replacingOccurrences(of: locale.decimalSeparator ?? ".", with: ".")
        guard normalized.range(of: #"^(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)$"#, options: .regularExpression) != nil,
              let value = Double(normalized), value.isFinite else { return nil }
        return value
    }
    public static func weight(_ kilograms: Double) -> Bool { kilograms.isFinite && (5...453.59237).contains(kilograms) }
}
