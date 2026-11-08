import Foundation

public struct Vial: Codable, Identifiable, Equatable, Sendable {
    public var id = UUID()
    public var received: Date
    public var medication: String
    public var concentration: Double
    public var volumeML: Double
    public var note: String
    public init(received: Date, medication: String, concentration: Double, volumeML: Double, note: String = "") {
        self.received = received; self.medication = medication; self.concentration = concentration; self.volumeML = volumeML; self.note = note
    }
    public var totalMilligrams: Double { concentration * volumeML }
    public func milligrams(units: Double, unitsPerML: Double) throws -> Double {
        guard units.isFinite && units > 0, unitsPerML.isFinite && unitsPerML > 0,
              concentration.isFinite && concentration > 0, volumeML.isFinite && volumeML > 0 else { throw TrackingError.invalidAmount }
        return units / unitsPerML * concentration
    }
}
