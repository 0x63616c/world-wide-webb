import Foundation

/// Shape-exact models for features/weather/api.ts. Temperatures are Fahrenheit.
public struct WeatherNow: Decodable, Sendable, Equatable {
    public let temp: Double
    public let cond: String
    public let ic: String
    public let hi: Double
    public let lo: Double
    public let feels: Double
    public let hum: Double
    public let wind: Double
    public let uvIndex: Double
    public let precipProbability: Double
    public let sunsetIso: String
    public let sunriseIso: String
    public let tomorrowSunriseIso: String
    public let solarLabel: String
    public let solarValue: String
    public let city: String
}

public struct WeatherHour: Decodable, Sendable, Equatable {
    public let t: String
    public let temp: Double
    public let feels: Double
    public let ic: String
    public let isDay: Bool
    public let isoTime: String
    public let weatherCode: Int
}

public struct WeatherDay: Decodable, Sendable, Equatable {
    public let date: String
    public let hi: Double
    public let lo: Double
    public let weatherCode: Int
    public let precipProbability: Double?
}

public struct WeatherAPI: Sendable {
    private let client: PanelAPIClient
    public init(client: PanelAPIClient) { self.client = client }
    public func now() async throws -> WeatherNow {
        try await client.query("weather.now", as: WeatherNow.self)
    }
    public func hourly() async throws -> [WeatherHour] {
        try await client.query("weather.hourly", as: [WeatherHour].self)
    }
    public func daily() async throws -> [WeatherDay] {
        try await client.query("weather.daily", as: [WeatherDay].self)
    }
}
