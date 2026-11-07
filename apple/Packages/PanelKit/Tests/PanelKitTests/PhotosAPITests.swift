import Foundation
import XCTest

@testable import PanelKit

final class PhotosAPITests: XCTestCase {
    func testShapeExactListingsAndMutationContracts() async throws {
        let transport = PhotosTestTransport()
        let api = PhotosAPI(client: client(transport))
        let booth = try await api.booth()
        XCTAssertEqual(booth.groups.first?.frames.first?.id, "bp_fixture")
        XCTAssertEqual(booth.groups.first?.filter, "mono")
        try await api.remove(groupID: "bpg_fixture")
        try await api.clearFilter(groupID: "bpg_fixture")
        let requests = await transport.requests
        XCTAssertEqual(
            requests.map { $0.url!.lastPathComponent },
            ["booth", "bpg_fixture", "filter"])
        for request in requests.suffix(2) {
            XCTAssertEqual(request.httpMethod, "DELETE")
            XCTAssertNil(request.httpBody)
        }
    }

    func testImagesUseAccessHeadersAndRejectUntrustedPaths() async throws {
        let transport = PhotosTestTransport()
        let api = PhotosAPI(client: client(transport))
        let bytes = try await api.image(collection: "booth-photos", path: "2027-01-15/bp_fixture.jpg")
        XCTAssertFalse(bytes.isEmpty)
        let requests = await transport.requests
        XCTAssertEqual(requests.first?.url?.path, "/media/booth-photos/2027-01-15/bp_fixture.jpg")
        XCTAssertEqual(requests.first?.value(forHTTPHeaderField: "CF-Access-Client-Id"), "fixture-id")
        XCTAssertEqual(requests.first?.value(forHTTPHeaderField: "CF-Access-Client-Secret"), "fixture-secret")
        for path in ["../secret", "/absolute", "https://other.invalid/x", "%2e%2e/x", "x?query", "x#fragment"] {
            do {
                _ = try await api.image(collection: "booth-photos", path: path)
                XCTFail("Accepted invalid path")
            } catch {}
        }
        let count = await transport.requests.count
        XCTAssertEqual(count, 1)
    }

    func testPINUsesSyncedSettingAndDoesNotSendDigits() async throws {
        let transport = PhotosTestTransport()
        let api = PhotosAPI(client: client(transport))
        let accepted = try await api.unlock(pin: "135790")
        let rejected = try await api.unlock(pin: "999999")
        XCTAssertTrue(accepted)
        XCTAssertFalse(rejected)
        for request in await transport.requests {
            XCTAssertEqual(request.url?.path, "/api/v1/settings/pin/verify")
            XCTAssertEqual(request.httpMethod, "POST")
            XCTAssertNil(request.url?.query)
        }
    }

    func testDiskMemoryBoundsAndClear() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let cache = PhotoCache(directory: directory, limit: 2)
        await cache.insert(Data([1]), for: "one")
        let cold = PhotoCache(directory: directory, limit: 2)
        let disk = await cold.data(for: "one")
        XCTAssertEqual(disk, Data([1]))
        await cache.insert(Data([2]), for: "two")
        await cache.insert(Data([3]), for: "three")
        let files = try FileManager.default.contentsOfDirectory(atPath: directory.path)
        XCTAssertEqual(files.count, 2)
        XCTAssertTrue(files.allSatisfy { $0.count == 64 })
        await cache.clear()
        let cleared = await cache.data(for: "one")
        XCTAssertNil(cleared)
        XCTAssertFalse(FileManager.default.fileExists(atPath: directory.path))
    }

    private func client(_ transport: PhotosTestTransport) -> PanelAPIClient {
        PanelAPIClient(
            configuration: PanelConfiguration(
                baseURL: URL(string: "https://fixtures.example.invalid")!,
                accessClientID: "fixture-id", accessClientSecret: "fixture-secret"), transport: transport)
    }
}

private actor PhotosTestTransport: PanelTransport {
    private(set) var requests: [URLRequest] = []
    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        requests.append(request)
        let url = request.url!
        let name: String
        if url.path == "/api/v1/settings/pin/verify" {
            let input = try JSONDecoder().decode([String: String].self, from: request.httpBody!)
            return reply(try JSONSerialization.data(withJSONObject: ["verified": input["pin"] == "135790"]), url: url)
        }
        if request.httpMethod == "DELETE" {
            return reply(Data((url.path.hasSuffix("/filter") ? "{\"cleared\":1}" : "{\"removed\":1}").utf8), url: url)
        }
        if url.path == "/api/v1/booth" {
            name = "booth"
        } else {
            let file = Bundle.module.url(forResource: "image", withExtension: "png", subdirectory: "Fixtures/photos")!
            return reply(try Data(contentsOf: file), url: url, image: true)
        }
        let file = Bundle.module.url(forResource: name, withExtension: "json", subdirectory: "Fixtures/photos")!
        return reply(try Data(contentsOf: file), url: url)
    }
    private func reply(_ data: Data, url: URL, image: Bool = false, status: Int = 200) -> (Data, HTTPURLResponse) {
        (
            data,
            HTTPURLResponse(
                url: url, statusCode: status, httpVersion: nil,
                headerFields: ["Content-Type": image ? "image/png" : "application/json"])!
        )
    }
}
