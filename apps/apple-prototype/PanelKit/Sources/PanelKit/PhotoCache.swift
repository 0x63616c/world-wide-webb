import Foundation
import CryptoKit

/// Bounded immutable-image cache; filenames contain no source path or credentials.
/// The caller scopes the directory to the configured server, and purges on removal.
public actor PhotoCache {
    private let directory: URL
    private let limit: Int
    private var memory: [String: Data] = [:]
    private var order: [String] = []
    public init(directory: URL, limit: Int = 24) {
        self.directory = directory
        self.limit = max(1, limit)
    }
    private func key(_ value: String) -> String {
        SHA256.hash(data: Data(value.utf8)).map { String(format: "%02x", $0) }.joined()
    }
    public func data(for value: String) -> Data? {
        let name = key(value)
        if let data = memory[name] { return data }
        guard let data = try? Data(contentsOf: directory.appendingPathComponent(name)) else { return nil }
        remember(data, name: name)
        return data
    }
    public func insert(_ data: Data, for value: String) {
        let name = key(value)
        remember(data, name: name)
        do {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            try data.write(to: directory.appendingPathComponent(name), options: [.atomic, .completeFileProtection])
            var values = URLResourceValues(); values.isExcludedFromBackup = true
            var folder = directory; try folder.setResourceValues(values)
            let files = try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: [.contentModificationDateKey])
            let sorted = files.sorted {
                ((try? $0.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? .distantPast) >
                ((try? $1.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? .distantPast)
            }
            for file in sorted.dropFirst(limit) { try? FileManager.default.removeItem(at: file) }
        } catch { /* Cache failure must not prevent a live image from displaying. */ }
    }
    public func clear() {
        memory.removeAll(); order.removeAll()
        try? FileManager.default.removeItem(at: directory)
    }
    private func remember(_ data: Data, name: String) {
        memory[name] = data
        order.removeAll { $0 == name }; order.append(name)
        while order.count > limit { memory.removeValue(forKey: order.removeFirst()) }
    }
}

/// Access headers must never follow redirects to a different host.
public final class PhotoSessionDelegate: NSObject, URLSessionTaskDelegate, Sendable {
    public func urlSession(_ session: URLSession, task: URLSessionTask,
                           willPerformHTTPRedirection response: HTTPURLResponse,
                           newRequest request: URLRequest,
                           completionHandler: @escaping @Sendable (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}
