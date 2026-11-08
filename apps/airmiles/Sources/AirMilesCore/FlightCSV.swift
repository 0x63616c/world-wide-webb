import Foundation

public enum FlightImportError: Error, LocalizedError, Equatable {
    case invalid(String)
    public var errorDescription: String? {
        switch self { case .invalid(let message): message }
    }
}

/// Strict, all-or-nothing import. Source mailbox identifiers are intentionally discarded.
public enum FlightCSV {
    public static func parse(_ csv: String) throws -> [Flight] {
        let rows = try readRows(csv.replacingOccurrences(of: "\u{FEFF}", with: ""))
        guard let header = rows.first else { throw FlightImportError.invalid("This file is empty.") }
        let names = header.map { $0.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() }
        let required = ["date", "airline", "flight", "from", "to", "miles", "confidence"]
        guard Set(names).count == names.count, required.allSatisfy(names.contains) else {
            throw FlightImportError.invalid("Expected date, airline, flight, from, to, miles and confidence columns.")
        }
        let indices = Dictionary(uniqueKeysWithValues: names.enumerated().map { ($1, $0) })
        let formatter = Flight.dateFormatter
        let flights: [Flight] = try rows.dropFirst().enumerated().map { offset, row in
            let line = offset + 2
            guard row.count == names.count else { throw FlightImportError.invalid("Row \(line) has the wrong number of columns.") }
            func field(_ name: String) -> String { row[indices[name]!].trimmingCharacters(in: .whitespacesAndNewlines) }
            let date = field("date")
            let origin = field("from").uppercased(), destination = field("to").uppercased()
            guard date.count == 10, let parsed = formatter.date(from: date), formatter.string(from: parsed) == date else {
                throw FlightImportError.invalid("Row \(line) needs a valid YYYY-MM-DD date.")
            }
            guard [origin, destination].allSatisfy({ $0.range(of: "^[A-Z]{3}$", options: .regularExpression) != nil }), origin != destination else {
                throw FlightImportError.invalid("Row \(line) needs two different three-letter airport codes.")
            }
            guard let miles = Int(field("miles")), (1...20_000).contains(miles), !field("airline").isEmpty,
                  let confidence = Confidence(rawValue: field("confidence").uppercased()) else {
                throw FlightImportError.invalid("Row \(line) needs an airline, positive miles (up to 20,000), and H, M or L confidence.")
            }
            return Flight(id: "\(offset)-\(date)-\(origin)-\(destination)", date: date, airline: field("airline"),
                          number: field("flight"), origin: origin, destination: destination, miles: miles, confidence: confidence)
        }
        guard !flights.isEmpty else { throw FlightImportError.invalid("This file has no flights.") }
        return flights.sorted { $0.date == $1.date ? $0.id < $1.id : $0.date > $1.date }
    }

    // Supports CRLF, quoted commas, escaped quotes and quoted newlines.
    static func readRows(_ text: String) throws -> [[String]] {
        let characters = Array(text.replacingOccurrences(of: "\r\n", with: "\n").replacingOccurrences(of: "\r", with: "\n"))
        var rows: [[String]] = [], row: [String] = [], field = ""
        var quoted = false, closedQuote = false, index = 0
        func finishRow() {
            row.append(field)
            if row.contains(where: { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }) { rows.append(row) }
            row = []; field = ""; closedQuote = false
        }
        while index < characters.count {
            let char = characters[index]
            if quoted {
                if char == "\"" {
                    if index + 1 < characters.count && characters[index + 1] == "\"" { field.append("\""); index += 1 }
                    else { quoted = false; closedQuote = true }
                } else { field.append(char) }
            } else if char == "," {
                row.append(field); field = ""; closedQuote = false
            } else if char == "\n" { finishRow() }
            else if char == "\"" && field.isEmpty && !closedQuote { quoted = true }
            else {
                guard !closedQuote && char != "\"" else { throw FlightImportError.invalid("The CSV contains an invalid quoted field.") }
                field.append(char)
            }
            index += 1
        }
        guard !quoted else { throw FlightImportError.invalid("The CSV has an unclosed quote.") }
        if !field.isEmpty || !row.isEmpty || closedQuote { finishRow() }
        return rows
    }
}
