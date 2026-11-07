import AVFoundation
import Foundation
import UniformTypeIdentifiers

/// Deliberately scoped to progressive MP4, not HLS manifests with child URLs.
/// Each fetch is bounded, ephemeral, and refuses every redirect before forwarding
/// credentials. The injectable transport also exercises AVFoundation offline.
public protocol MediaByteTransport: Sendable {
    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse)
}

public final class MediaHTTPTransport: MediaByteTransport, Sendable {
    private let session: URLSession
    public init() {
        let config = URLSessionConfiguration.ephemeral
        config.urlCache = nil
        config.httpCookieStorage = nil
        config.urlCredentialStorage = nil
        session = URLSession(configuration: config, delegate: NoMediaRedirects(), delegateQueue: nil)
    }
    deinit { session.invalidateAndCancel() }

    public func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        let (bytes, response) = try await session.bytes(for: request)
        defer { bytes.task.cancel() }
        guard let response = response as? HTTPURLResponse, response.statusCode == 206,
              response.url == request.url else { throw MediaError.invalidResponse }
        var data = Data()
        for try await byte in bytes {
            guard data.count < MediaStream.chunkSize else { throw MediaError.invalidResponse }
            data.append(byte)
        }
        try Task.checkCancellation()
        return (data, response)
    }
}

private final class NoMediaRedirects: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest,
                    completionHandler: @escaping @Sendable (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}

struct MediaByteRange {
    let end: Int64
    let total: Int64
    init(response: HTTPURLResponse, data: Data, offset: Int64, length: Int) throws {
        guard response.statusCode == 206, response.mimeType == "video/mp4",
              let header = response.value(forHTTPHeaderField: "Content-Range"),
              header.hasPrefix("bytes ") else { throw MediaError.invalidResponse }
        let parts = header.dropFirst(6).split(whereSeparator: { $0 == "-" || $0 == "/" })
        guard parts.count == 3, let start = Int64(parts[0]), let end = Int64(parts[1]),
              let total = Int64(parts[2]), start == offset, end >= start, total > end,
              end - start < Int64(length), end - start + 1 == Int64(data.count),
              // A shorter range is valid only at EOF; never silently truncate a stream.
              data.count == length || end + 1 == total else { throw MediaError.invalidResponse }
        self.end = end; self.total = total
    }
}

/// Retain this owner for the lifetime of its player item: AVURLAsset's delegate
/// is weak. All loader state is confined to the main delegate queue.
@MainActor public final class MediaPlayback {
    public let item: AVPlayerItem
    private let loader: MediaResourceLoader

    public init(stream: MediaStream, transport: any MediaByteTransport = MediaHTTPTransport()) {
        loader = MediaResourceLoader(stream: stream, transport: transport)
        // No deployment address or credential is embedded in AVFoundation's URL.
        let asset = AVURLAsset(url: URL(string: "panel-media://stream/video.mp4")!)
        asset.resourceLoader.setDelegate(loader, queue: .main)
        item = AVPlayerItem(asset: asset)
    }

    public func stop() { loader.stop() }
}

@MainActor private final class MediaResourceLoader: NSObject, @preconcurrency AVAssetResourceLoaderDelegate {
    private let stream: MediaStream
    private let transport: any MediaByteTransport
    private var tasks: [ObjectIdentifier: Task<Void, Never>] = [:]
    private var stopped = false

    init(stream: MediaStream, transport: any MediaByteTransport) {
        self.stream = stream; self.transport = transport
    }

    func resourceLoader(_ resourceLoader: AVAssetResourceLoader,
                        shouldWaitForLoadingOfRequestedResource request: AVAssetResourceLoadingRequest) -> Bool {
        guard !stopped else { return false }
        let id = ObjectIdentifier(request)
        tasks[id] = Task { [weak self] in
            guard let self else { return }
            defer { tasks[id] = nil }
            do {
                try await load(request)
                try Task.checkCancellation()
                if !request.isCancelled { request.finishLoading() }
            } catch {
                // Never surface a transport error containing URLs or credentials.
                if !request.isCancelled { request.finishLoading(with: MediaError.invalidResponse) }
            }
        }
        return true
    }

    private func load(_ request: AVAssetResourceLoadingRequest) async throws {
        let dataRequest = request.dataRequest
        var offset = max(dataRequest?.requestedOffset ?? 0, dataRequest?.currentOffset ?? 0)
        let requestedOffset = dataRequest?.requestedOffset ?? 0
        let requestedLength = Int64(dataRequest?.requestedLength ?? 2)
        guard requestedOffset >= 0, requestedLength > 0,
              requestedOffset <= Int64.max - requestedLength else { throw MediaError.invalidStream }
        let requestedEnd = requestedOffset + requestedLength
        var total: Int64?
        repeat {
            try Task.checkCancellation()
            let end = dataRequest?.requestsAllDataToEndOfResource == true ? total ?? Int64.max : requestedEnd
            let length = Int(min(Int64(MediaStream.chunkSize), end - offset))
            guard length > 0 else { break }
            let urlRequest = try stream.request(offset: offset, length: length)
            let (data, response) = try await transport.send(urlRequest)
            try Task.checkCancellation()
            guard response.url == stream.url else { throw MediaError.invalidResponse }
            let range = try MediaByteRange(response: response, data: data, offset: offset, length: length)
            if let total, total != range.total { throw MediaError.invalidResponse }
            total = range.total
            if let info = request.contentInformationRequest {
                info.contentType = UTType.mpeg4Movie.identifier
                info.contentLength = range.total
                info.isByteRangeAccessSupported = true
            }
            dataRequest?.respond(with: data)
            offset = range.end + 1
            if dataRequest == nil || offset == range.total { break }
        } while dataRequest?.requestsAllDataToEndOfResource == true || offset < requestedEnd
    }

    func resourceLoader(_ resourceLoader: AVAssetResourceLoader, didCancel request: AVAssetResourceLoadingRequest) {
        tasks.removeValue(forKey: ObjectIdentifier(request))?.cancel()
    }

    func stop() {
        stopped = true
        for task in tasks.values { task.cancel() }
        tasks.removeAll()
    }
}
