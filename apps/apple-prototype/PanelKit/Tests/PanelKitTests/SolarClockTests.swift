import Foundation
import Testing
@testable import PanelKit

@Suite struct SolarClockTests {
    let sunrise = Date(timeIntervalSince1970: 1_800_000_000)
    @Test func changesAtExactSolarBoundaries() {
        let sunset = sunrise.addingTimeInterval(36_000)
        let tomorrow = sunrise.addingTimeInterval(86_400)
        #expect(SolarClock.isNight(at: sunrise.addingTimeInterval(-1), sunrise: sunrise, sunset: sunset, nextSunrise: tomorrow) == true)
        #expect(SolarClock.isNight(at: sunrise, sunrise: sunrise, sunset: sunset, nextSunrise: tomorrow) == false)
        #expect(SolarClock.isNight(at: sunset.addingTimeInterval(-1), sunrise: sunrise, sunset: sunset, nextSunrise: tomorrow) == false)
        #expect(SolarClock.isNight(at: sunset, sunrise: sunrise, sunset: sunset, nextSunrise: tomorrow) == true)
        #expect(SolarClock.isNight(at: tomorrow, sunrise: sunrise, sunset: sunset, nextSunrise: tomorrow) == false)
    }
    @Test func rejectsMissingOrReversedSchedule() {
        #expect(SolarClock.isNight(at: sunrise, sunrise: nil, sunset: nil, nextSunrise: nil) == nil)
        #expect(SolarClock.isNight(at: sunrise, sunrise: sunrise, sunset: sunrise.addingTimeInterval(-1), nextSunrise: sunrise.addingTimeInterval(1)) == nil)
    }
    @Test func acceptsBothProviderTimestampFormats() {
        #expect(SolarClock.timestamp("2026-11-02T16:59:00-08:00") == SolarClock.timestamp("2026-11-03T00:59:00.000Z"))
        #expect(SolarClock.timestamp("invalid") == nil)
    }
}
