import ActivityKit
import Foundation
import PanelKit

struct NextAlarm: Decodable, Sendable {
    let id: String
    let label: String
    let at: String
}

struct AlarmSnapshot: Decodable, Sendable { let next: NextAlarm? }

public enum PanelAlarmError: LocalizedError {
    case notConfigured, invalidDate
    case server(Int)
    case invalidURL
    public var errorDescription: String? {
        switch self {
        case .notConfigured: return "Connect this device to Tailscale."
        case .invalidDate: return "Choose a future alarm date and time."
        case .server(let status): return "Control Center could not save the alarm (HTTP \(status)). Try again."
        case .invalidURL: return "The alarm server must use HTTPS."
        }
    }
}

// Keep API requests on their configured private origin.
private final class NoRedirects: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
    func urlSession(
        _ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
        newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void
    ) {
        completionHandler(nil)
    }
}

/// Shared by the native panel and App Intents. The server owns the
/// schedule; this module only mirrors its next instant into ActivityKit.
public actor PanelAlarmCoordinator {
    public static let shared = PanelAlarmCoordinator()
    private var serverURL = PanelKit.PanelConfiguration.defaultBaseURL
    private let session = URLSession(configuration: .ephemeral, delegate: NoRedirects(), delegateQueue: nil)

    public func configure(url: String) throws {
        guard let value = PanelKit.PanelConfiguration.fromEnvironment(["WWW_PANEL_API_URL": url]) else {
            throw PanelAlarmError.invalidURL
        }
        serverURL = value.baseURL
    }

    private func request(method: String, body: Data? = nil, key: String? = nil, action: Bool = false) async throws
        -> Data
    {
        let endpoint = serverURL.appendingPathComponent(action ? "api/v1/alarms/action" : "api/v1/alarms")
        var request = URLRequest(url: endpoint, timeoutInterval: 12)
        request.httpMethod = method
        request.httpBody = body
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(key, forHTTPHeaderField: "Idempotency-Key")
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw PanelAlarmError.server((response as? HTTPURLResponse)?.statusCode ?? 0)
        }
        return data
    }

    public func create(at: Date, label: String) async throws {
        guard at > Date() else { throw PanelAlarmError.invalidDate }
        let body = try JSONSerialization.data(withJSONObject: [
            "label": label,
            "at": ISO8601DateFormatter().string(from: at), "timeZone": TimeZone.current.identifier,
        ])
        // Reuse this key if the response is lost; the server deduplicates the insert.
        let key = UUID().uuidString
        do { _ = try await request(method: "POST", body: body, key: key) } catch let error as URLError
            where error.code == .timedOut || error.code == .networkConnectionLost
        {
            _ = try await request(method: "POST", body: body, key: key)
        }
        // Creation succeeded even if ActivityKit is unavailable/disabled.
        try? await refresh()
    }

    func act(delivery: AlarmDelivery, snooze: Bool) async throws {
        // The worker may not have materialized the occurrence at the exact instant
        // AlarmKit alerts. Wait briefly for that exact ring, never act on a newer one.
        var ring: ActiveAlarm?
        for attempt in 0..<4 {
            let snapshot = try JSONDecoder().decode(AlarmsSnapshot.self, from: await request(method: "GET"))
            ring = snapshot.active.first { delivery.matches($0) && $0.isRinging(at: Date()) }
            if ring != nil { break }
            if attempt < 3 { try await Task.sleep(for: .seconds(1)) }
        }
        guard let ring else { throw NativeAlarmFailure.unavailable }
        let body = try JSONSerialization.data(withJSONObject: [
            "id": ring.id, "version": ring.version, "action": snooze ? "snooze" : "stop",
        ])
        _ = try await request(method: "POST", body: body, action: true)
        let data = try await request(method: "GET")
        let snapshot = try JSONDecoder().decode(AlarmsSnapshot.self, from: data)
        try await NativeAlarmScheduler.shared.sync(snapshot)
        try await sync(json: String(decoding: data, as: UTF8.self))
    }

    public func refresh() async throws {
        let data = try await request(method: "GET")
        let snapshot = try JSONDecoder().decode(AlarmSnapshot.self, from: data)
        try await updateActivity(snapshot.next)
    }

    public func sync(json: String) async throws {
        let snapshot = try JSONDecoder().decode(AlarmSnapshot.self, from: Data(json.utf8))
        try await updateActivity(snapshot.next)
    }

    private func updateActivity(_ next: NextAlarm?) async throws {
        guard #available(iOS 16.2, *) else { return }
        let current = Activity<NextAlarmAttributes>.activities
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let date = next.flatMap { formatter.date(from: $0.at) ?? ISO8601DateFormatter().date(from: $0.at) }
        let now = Date()
        guard let next, let date, date > now else {
            for activity in current { await activity.end(nil, dismissalPolicy: .immediate) }
            return
        }
        let content = ActivityContent(
            state: NextAlarmAttributes.ContentState(label: next.label, fireAt: date, updatedAt: now),
            staleDate: date)
        let matching = current.first { $0.attributes.alarmID == next.id }
        for activity in current where activity.id != matching?.id {
            await activity.end(nil, dismissalPolicy: .immediate)
        }
        if let matching {
            await matching.update(content)
        } else if ActivityAuthorizationInfo().areActivitiesEnabled {
            _ = try Activity.request(
                attributes: NextAlarmAttributes(alarmID: next.id), content: content, pushType: nil)
        }
    }
}
