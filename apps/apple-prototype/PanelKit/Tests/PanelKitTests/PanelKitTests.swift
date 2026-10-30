import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
import Testing
@testable import PanelKit

private actor StubTransport: PanelTransport {
    private(set) var requests: [URLRequest] = []
    let data: Data
    let status: Int
    let failure: URLError?

    init(_ data: Data, status: Int = 200, failure: URLError? = nil) {
        self.data = data; self.status = status; self.failure = failure
    }

    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        requests.append(request)
        if let failure { throw failure }
        return (data, HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!)
    }
}

private func fixture(_ name: String) throws -> Data {
    let url = try #require(Bundle.module.url(forResource: name, withExtension: "json", subdirectory: "Fixtures"))
    return try Data(contentsOf: url)
}

private func client(_ transport: StubTransport) -> PanelAPIClient {
    PanelAPIClient(configuration: PanelConfiguration(
        baseURL: URL(string: "https://panel.example.invalid/panel/")!,
        accessClientID: "test-client-id", accessClientSecret: "test-client-secret", requestTimeout: 12
    ), transport: transport)
}

@Test func queryWithoutInputAndAuthHeaders() async throws {
    let transport = StubTransport(try fixture("all-on"))
    let state = try await LightsAPI(client: client(transport)).list()
    #expect(state.lamps.count == 8)
    let request = try #require(await transport.requests.first)
    #expect(request.url?.absoluteString == "https://panel.example.invalid/panel/trpc/controls.list")
    #expect(request.httpMethod == "GET")
    #expect(request.httpBody == nil)
    #expect(request.value(forHTTPHeaderField: "Accept") == "application/json")
    #expect(request.value(forHTTPHeaderField: "CF-Access-Client-Id") == "test-client-id")
    #expect(request.value(forHTTPHeaderField: "CF-Access-Client-Secret") == "test-client-secret")
    #expect(request.timeoutInterval == 12)
}

@Test func queryInputIsPlainPercentEncodedJSON() async throws {
    let transport = StubTransport(try fixture("all-on"))
    let input = ["value": "#00ff00 + &?/= café"]
    let _: ControlsState = try await client(transport).query("controls.list", input: input, as: ControlsState.self)
    let request = try #require(await transport.requests.first)
    let url = try #require(request.url)
    let components = try #require(URLComponents(url: url, resolvingAgainstBaseURL: false))
    #expect(components.percentEncodedQuery?.contains("%2B") == true)
    #expect(components.percentEncodedQuery?.contains("%23") == true)
    let decoded = try #require(components.queryItems?.first?.value)
    #expect(try JSONDecoder().decode([String: String].self, from: Data(decoded.utf8)) == input)
    #expect(components.queryItems?.count == 1)
    #expect(request.httpBody == nil)
}

@Test func mutationUsesPlainBodyAndAllMethodsMatchRouter() async throws {
    let transport = StubTransport(try fixture("all-on"))
    let api = LightsAPI(client: client(transport))
    _ = try await api.toggle(.bedroomLamps, on: true)
    _ = try await api.setScene(.mood)
    _ = try await api.setColor(slot: .custom, hex: "#Ab12Cd")
    _ = try await api.setColor(slot: .blue)
    _ = try await api.setWhiteKelvin(6500)
    _ = try await api.setBrightness(pct: 0)
    _ = try await api.setMode(.party, speed: .medium)
    _ = try await api.setMode(.none)
    let expected = [
        ("toggle", ##"{"key":"bedroomLamps","on":true}"##),
        ("setLampScene", ##"{"scene":"mood"}"##),
        ("setLampColor", ##"{"slot":"custom","hex":"#Ab12Cd"}"##),
        ("setLampColor", ##"{"slot":"blue"}"##),
        ("setWhiteKelvin", ##"{"kelvin":6500}"##),
        ("setLampBrightness", ##"{"pct":0}"##),
        ("setLampMode", ##"{"mode":"party","speed":"medium"}"##),
        ("setLampMode", ##"{"mode":"none"}"##)
    ]
    let requests = await transport.requests
    #expect(requests.count == expected.count)
    for (request, (path, json)) in zip(requests, expected) {
        #expect(request.url?.path == "/panel/trpc/controls.\(path)")
        #expect(request.url?.query == nil)
        #expect(request.httpMethod == "POST")
        #expect(request.value(forHTTPHeaderField: "Content-Type") == "application/json")
        #expect(request.value(forHTTPHeaderField: "Accept") == "application/json")
        #expect(request.value(forHTTPHeaderField: "CF-Access-Client-Secret") == "test-client-secret")
        let body = try #require(request.httpBody)
        #expect(try JSONSerialization.jsonObject(with: body) as? NSDictionary == JSONSerialization.jsonObject(with: Data(json.utf8)) as? NSDictionary)
    }
}

@Test(arguments: ["all-on", "all-off", "pending", "party", "null-scene", "mood", "red", "blue"])
func decodeEveryStateVariant(name: String) async throws {
    let state = try await LightsAPI(client: client(StubTransport(try fixture(name)))).list()
    #expect(state.lamps.savedColors.map(\.slot) == [.red, .blue, .custom])
    #expect(state.lamps.whiteKelvin == 2700)
    #expect(state.lamps.brightness == 65) // Server retains desired brightness while off.
    #expect(state.lamps.pending == false)
    #expect(state.fan.pending == (name == "pending"))
    #expect(state.pendingKeys == (name == "pending" ? ["fan"] : []))
    if name == "all-off" || name == "null-scene" { #expect(state.lamps.activeScene == nil) }
    if name == "all-off" { #expect(state.lamps.count == 0); #expect(!state.all.on) }
    if name == "all-on" { #expect(state.all.on); #expect(state.lamps.activeScene == .white) }
    if ["party", "mood", "red", "blue"].contains(name) { #expect(state.lamps.activeScene?.rawValue == name) }
    if name == "null-scene" { #expect(state.bedroomLamps.on); #expect(!state.otherLamps.on) }
}

@Test func serverEnvelopePreservesCodeAndStatus() async throws {
    let json = ##"{"error":{"message":"Service is unavailable","code":-32603,"data":{"code":"SERVICE_UNAVAILABLE","httpStatus":503}}}"##
    let api = LightsAPI(client: client(StubTransport(Data(json.utf8), status: 503)))
    do { _ = try await api.list(); Issue.record("Expected service error") }
    catch let error as PanelAPIError {
        #expect(error == .server(code: "SERVICE_UNAVAILABLE", message: "Service is unavailable", httpStatus: 503))
        #expect(error.isServiceUnavailable)
    }
    #expect(PanelAPIError.http(status: 503).isServiceUnavailable)
    #expect(PanelAPIError.server(code: "SERVICE_UNAVAILABLE", message: "Unavailable", httpStatus: nil).isServiceUnavailable)
    #expect(!PanelAPIError.http(status: 401).isServiceUnavailable)
}

@Test func malformedJSONAndHTTPFailures() async throws {
    for status in [200, 503, 401] {
        let api = LightsAPI(client: client(StubTransport(Data("<html>Unavailable</html>".utf8), status: status)))
        do { _ = try await api.list(); Issue.record("Expected failure") }
        catch let error as PanelAPIError {
            if status == 200 {
                guard case .decoding = error else { Issue.record("Expected decoding error"); return }
            } else { #expect(error == .http(status: status)) }
        }
    }
}

@Test func transportFailureAndCancellation() async throws {
    let failed = StubTransport(Data(), failure: URLError(.notConnectedToInternet))
    do { _ = try await LightsAPI(client: client(failed)).list(); Issue.record("Expected transport failure") }
    catch let error as PanelAPIError {
        guard case .transport = error else { Issue.record("Expected transport error"); return }
    }
    let cancelled = StubTransport(Data(), failure: URLError(.cancelled))
    await #expect(throws: CancellationError.self) { try await LightsAPI(client: client(cancelled)).list() }
}

@Test func notConfiguredAndPartialCredentials() async throws {
    let transport = StubTransport(try fixture("all-off"))
    let missing = PanelAPIClient(configuration: nil, transport: transport)
    await #expect(throws: PanelAPIError.notConfigured) { try await missing.query("controls.list", as: ControlsState.self) }
    #expect(await transport.requests.isEmpty)
    let partial = PanelAPIClient(configuration: PanelConfiguration(baseURL: URL(string: "https://panel.example.invalid")!, accessClientID: "test-client-id"), transport: transport)
    _ = try await partial.query("controls.list", as: ControlsState.self)
    let request = try #require(await transport.requests.first)
    #expect(request.value(forHTTPHeaderField: "CF-Access-Client-Id") == nil)
    #expect(request.value(forHTTPHeaderField: "CF-Access-Client-Secret") == nil)
}

@Test func environmentValidationAndRedaction() throws {
    #expect(PanelConfiguration.fromEnvironment([:]) == nil)
    for url in ["", "not a URL", "https://", "/relative", "http://panel.example.invalid", "ftp://panel.example.invalid", "https://test@panel.example.invalid", "https://panel.example.invalid?token=test", "https://panel.example.invalid/#fragment"] {
        #expect(PanelConfiguration.fromEnvironment(["WWW_PANEL_API_URL": url]) == nil)
    }
    for url in ["https://panel.example.invalid", "http://localhost:4201", "http://127.0.0.1:4201", "http://[::1]:4201"] {
        #expect(PanelConfiguration.fromEnvironment(["WWW_PANEL_API_URL": url]) != nil)
    }
    let config = try #require(PanelConfiguration.fromEnvironment([
        "WWW_PANEL_API_URL": "https://panel.example.invalid",
        "WWW_CF_ACCESS_CLIENT_ID": "test-client-id", "WWW_CF_ACCESS_CLIENT_SECRET": "test-client-secret"
    ]))
    #expect(config.accessClientID == "test-client-id")
    #expect(config.accessClientSecret == "test-client-secret")
    for text in [config.description, config.debugDescription, String(reflecting: config)] {
        #expect(!text.contains("test-client-id")); #expect(!text.contains("test-client-secret"))
        #expect(text.contains("<redacted>"))
    }
}

#if canImport(Security)
@Test func environmentCredentialsTakePrecedenceOverKeychain() throws {
    let config = try #require(PanelConfiguration.fromEnvironment([
        "WWW_PANEL_API_URL": "https://panel.example.invalid", "WWW_CF_ACCESS_CLIENT_ID": "test-environment-id"
    ]))
    var requested: [PanelKeychain.Key] = []
    let resolved = config.fillingCredentials { key in requested.append(key); return "test-keychain-value" }
    #expect(resolved.accessClientID == "test-environment-id")
    #expect(resolved.accessClientSecret == "test-keychain-value")
    #expect(requested == [.accessClientSecret])
    #expect(PanelConfiguration.resolve([:]) == nil)
}
#endif

@Test func invalidMutationInputsDoNotReachTransport() async throws {
    let transport = StubTransport(try fixture("all-on"))
    let api = LightsAPI(client: client(transport))
    for value in [-1, 101] {
        do { _ = try await api.setBrightness(pct: value); Issue.record("Expected invalid brightness") }
        catch let error as PanelAPIError { guard case .server("BAD_REQUEST", _, 400) = error else { throw error } }
    }
    for value in [1999, 6501] {
        do { _ = try await api.setWhiteKelvin(value); Issue.record("Expected invalid kelvin") }
        catch let error as PanelAPIError { guard case .server("BAD_REQUEST", _, 400) = error else { throw error } }
    }
    for hex in ["ff0000", "#abc", "#zzzzzz", "#ff0000\n"] {
        do { _ = try await api.setColor(slot: .red, hex: hex); Issue.record("Expected invalid color") }
        catch let error as PanelAPIError { guard case .server("BAD_REQUEST", _, 400) = error else { throw error } }
    }
    #expect(await transport.requests.isEmpty)
}
