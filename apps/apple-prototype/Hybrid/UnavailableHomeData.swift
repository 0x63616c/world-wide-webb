import Foundation
import Observation

// HomeDataSource's legacy scalar fields are nonoptional. These neutral values
// are never rendered as readings: the router requires a live module first.
extension LampState {
    static var unavailable: Self {
        Self(on: Array(repeating: false, count: 8), ceiling: false, cabinet: false,
             brightness: 0, kelvin: 0, scene: "Unavailable", colors: ["", "", ""],
             activeColor: nil, party: .off, lampColors: Array(repeating: "#000000", count: 8))
    }
}

extension ClimateState {
    static var unavailable: Self {
        Self(mode: .off, target: 0, low: 0, high: 0, ambient: 0, fanOn: false,
             reportedFanLabel: "Unavailable", reportedAction: "Unavailable")
    }
}

extension WeatherState {
    static var unavailable: Self {
        Self(city: "Unavailable", temperature: 0, condition: "Unavailable", symbol: "questionmark", high: 0,
             low: 0, feels: 0, humidity: 0, wind: 0, solarLabel: "Unavailable",
             solarValue: "—", hours: [])
    }
}

/// Modules without a live implementation stay on the web board. Satisfy the
/// shared protocol with empty, inert providers, never MockHomeDataSource.
@MainActor @Observable final class UnavailableHomeProviders:
    TeslaProvider, CalendarProvider, PhotosProvider, CamerasProvider, MediaProvider, WalkProvider {
    let data = TeslaData(name: "Unavailable", nick: "Unavailable", place: "", charging: false,
                         chargingState: "", rate: 0, pct: 0, range: 0, odo: "", climate: 0)
    let availability: TeslaAvailability = .offline
    let events: [AgendaEvent] = []
    let photos: [PhotoItem] = []
    let feeds: [CameraFeed] = []
    let items: [MediaItem] = []
    let videoURL: URL? = nil
    let activeWalk: DogWalk? = nil
    let history: [DogWalk] = []
    func next(at date: Date) -> AgendaEvent? { nil }
    func send(_ command: TeslaCommand) {}
    func start(at date: Date) {}
    func stop(at date: Date) {}
}
