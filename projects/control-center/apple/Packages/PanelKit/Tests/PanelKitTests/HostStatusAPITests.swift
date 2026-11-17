import Foundation
import Testing

@testable import PanelKit

#if canImport(FoundationNetworking)
    import FoundationNetworking
#endif

@Suite struct HostStatusAPITests {
    private let now = Date(timeIntervalSince1970: 1_800_000_000)

    private func status(nas: HostStatus.Check, deploy: HostStatus.Check = .init(state: "ok"), stale: Bool = false)
        -> HostStatus
    {
        HostStatus(nas: nas, deploy: deploy, stale: stale)
    }

    @Test func nasFailureWaitsOutTheGracePeriodAndSuppressesTheDeployNotice() {
        let blocked = HostStatus.Check(state: "blocked", since: now - 3_600, reason: "The backup step failed")
        let recent = HostStatus.Check(state: "failing", since: now - 60, reason: "The Mini can’t reach the NAS")
        #expect(status(nas: recent).notices(now: now).isEmpty)
        #expect(status(nas: recent, deploy: blocked).notices(now: now).map(\.key) == ["host-deploy"])
        let long = HostStatus.Check(
            state: "failing", since: now - HostStatus.nasGrace, reason: "The NAS rejected the Mini’s login")
        #expect(
            status(nas: long, deploy: blocked).notices(now: now)
                == [
                    HostNotice(
                        key: "host-nas", title: "NAS unavailable",
                        body: "Backups and Mini updates are paused. The NAS rejected the Mini’s login.")
                ])
        #expect(
            status(nas: .init(state: "ok"), deploy: blocked).notices(now: now).first?.body
                == "New versions aren’t being installed. The backup step failed.")
    }

    @Test func staleOrUnknownStatusShowsNothing() {
        let long = HostStatus.Check(state: "failing", since: now - 7_200)
        #expect(status(nas: long, stale: true).notices(now: now).isEmpty)
        #expect(status(nas: .init(state: "unknown"), deploy: .init(state: "unknown")).notices(now: now).isEmpty)
        #expect(status(nas: long).notices(now: now).first?.body == "Backups and Mini updates are paused.")
    }

    @Test func decodesServerStatusAndLogs() async throws {
        let json = #"""
            {"nas":{"state":"failing","since":"2026-11-17T01:00:00.123456Z","reason":"x"},
             "deploy":{"state":"ok"},"updatedAt":"2026-11-17T02:00:00+00:00","stale":false}
            """#
        let transport = HostStub(Data(json.utf8))
        let decoded = try await api(transport).status()
        #expect(decoded.nas.state == "failing")
        #expect(decoded.nas.since == HostStatus.date("2026-11-17T01:00:00.123456Z"))
        #expect(decoded.updatedAt == HostStatus.date("2026-11-17T02:00:00Z"))
        #expect(await transport.requests.first?.url?.path == "/api/v1/host/status")

        let log = try await api(
            HostStub(Data(#"{"source":"deploy","updatedAt":null,"lines":["ok","Error: boom"]}"#.utf8))
        )
        .log("deploy")
        #expect(log.errors == ["Error: boom"])
        await #expect(throws: PanelAPIError.self) { _ = try await api(HostStub(Data())).log("../status") }
    }

    @Test func missingEndpointIsReportedAsNotFound() async {
        do {
            _ = try await api(HostStub(Data(#"{"error":"Not found"}"#.utf8), status: 404)).status()
            Issue.record("Expected a 404")
        } catch let error as PanelAPIError {
            #expect(error.isNotFound)
        } catch { Issue.record("Unexpected \(error)") }
    }

    private func api(_ transport: HostStub) -> HostStatusAPI {
        HostStatusAPI(
            client: PanelAPIClient(
                configuration: PanelConfiguration(baseURL: URL(string: "https://panel.example.invalid")!),
                transport: transport))
    }
}

private actor HostStub: PanelTransport {
    private(set) var requests: [URLRequest] = []
    let data: Data
    let status: Int
    init(_ data: Data, status: Int = 200) {
        self.data = data
        self.status = status
    }
    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        requests.append(request)
        return (data, HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!)
    }
}
