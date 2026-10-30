#if canImport(Security)
import Foundation
import Security

public enum PanelKeychain {
    public static let service = "co.worldwidewebb.panel"

    public enum Key: String, Sendable {
        case accessClientID = "WWW_CF_ACCESS_CLIENT_ID"
        case accessClientSecret = "WWW_CF_ACCESS_CLIENT_SECRET"
    }

    public enum Failure: Error, Sendable {
        case status(OSStatus)
        case invalidEncoding
    }

    public static func load(_ key: Key) throws -> String? {
        var query = query(for: key)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess else { throw Failure.status(status) }
        guard let data = result as? Data, let value = String(data: data, encoding: .utf8)
        else { throw Failure.invalidEncoding }
        return value
    }

    /// Passing nil removes the value. Items are local to this device and never synchronized.
    public static func save(_ value: String?, for key: Key) throws {
        let query = query(for: key)
        guard let value else {
            let status = SecItemDelete(query as CFDictionary)
            guard status == errSecSuccess || status == errSecItemNotFound else { throw Failure.status(status) }
            return
        }
        let attributes: [String: Any] = [
            kSecValueData as String: Data(value.utf8),
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        ]
        var status = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
        if status == errSecItemNotFound {
            status = SecItemAdd(query.merging(attributes) { _, new in new } as CFDictionary, nil)
        }
        guard status == errSecSuccess else { throw Failure.status(status) }
    }

    private static func query(for key: Key) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword,
         kSecAttrService as String: service,
         kSecAttrAccount as String: key.rawValue]
    }
}
#endif
