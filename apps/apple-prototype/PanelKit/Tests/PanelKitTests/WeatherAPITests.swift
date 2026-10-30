import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
import Testing
@testable import PanelKit

private actor WeatherTransport: PanelTransport {
    let data: Data
    let status: Int
    private(set) var requests: [URLRequest] = []
    init(_ name: String, status: Int = 200) throws {
        let url = try #require(Bundle.module.url(forResource: name, withExtension: "json", subdirectory: "Fixtures/weather"))
        data = try Data(contentsOf: url)
        self.status = status
    }
    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        requests.append(request)
        return (data, HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!)
    }
    var api: WeatherAPI {
        WeatherAPI(client: PanelAPIClient(configuration: PanelConfiguration(
            baseURL: URL(string: "https://weather.example.invalid")!), transport: self))
    }
}

@Test func weatherNowFixtureAndQuery() async throws {
    let transport = try WeatherTransport("now")
    let now = try await transport.api.now()
    #expect(now.temp == 62.5 && now.feels == 60.2)
    #expect(now.cond == "Partly Cloudy" && now.ic == "cloud-sun")
    #expect(now.hi == 68 && now.lo == 51 && now.hum == 70 && now.wind == 9.5)
    #expect(now.uvIndex == 3.2 && now.precipProbability == 20)
    #expect(now.sunriseIso == "2026-10-29T07:20")
    #expect(now.sunsetIso == "2026-10-29T18:10")
    #expect(now.tomorrowSunriseIso == "2026-10-30T07:21")
    #expect(now.city == "Example City" && now.solarLabel == "Sunset" && now.solarValue == "6:10 PM")
    let request = try #require(await transport.requests.first)
    #expect(request.httpMethod == "GET" && request.httpBody == nil)
    #expect(request.url?.path == "/trpc/weather.now" && request.url?.query == nil)
}

@Test func weatherHourlyAndDailyFixtures() async throws {
    let hourlyTransport = try WeatherTransport("hourly")
    let hours = try await hourlyTransport.api.hourly()
    #expect(hours.count == 12 && hours[0].t == "Now")
    #expect(hours[0].isoTime == "2026-10-29T12:00:00.000Z")
    #expect(hours[0].weatherCode == 2 && hours[0].isDay)
    #expect(!hours[11].isDay && hours[11].ic == "moon")
    #expect(await hourlyTransport.requests.first?.url?.path == "/trpc/weather.hourly")
    let dailyTransport = try WeatherTransport("daily")
    let days = try await dailyTransport.api.daily()
    #expect(days[0].date == "2026-10-29" && days[0].hi == 68 && days[0].lo == 51)
    #expect(days[0].precipProbability == nil && days[1].precipProbability == 80)
    #expect(await dailyTransport.requests.first?.url?.path == "/trpc/weather.daily")
}

@Test func weatherEmptyDatabaseErrorAndEmptyForecast() async throws {
    let transport = try WeatherTransport("empty-db", status: 500)
    do {
        _ = try await transport.api.now()
        Issue.record("Expected empty database failure")
    } catch let error as PanelAPIError {
        #expect(error == .server(code: "INTERNAL_SERVER_ERROR", message: "no current weather reading", httpStatus: 500))
    }
    let empty = try WeatherTransport("empty-hourly")
    #expect(try await empty.api.hourly().isEmpty)
}
