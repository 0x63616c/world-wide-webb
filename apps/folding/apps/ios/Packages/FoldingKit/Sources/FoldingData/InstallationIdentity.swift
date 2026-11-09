import Darwin
import FoldingDomain
import Foundation
import Security

public enum InstallationIdentity {
  /// Shared by the app and intents through their configured Keychain access group.
  /// ThisDeviceOnly prevents a device backup from cloning the active source identity.
  public static func loadOrCreate(service: String, accessGroup: String?, directory: URL) throws
    -> UUID
  {
    return try StorageAccess.withProtection { lease in
      try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
      var identityDirectory = directory
      var values = URLResourceValues()
      values.isExcludedFromBackup = true
      try identityDirectory.setResourceValues(values)
      let lock = open(
        directory.appendingPathComponent("identity.lock").path, O_CREAT | O_RDWR, S_IRUSR | S_IWUSR)
      guard lock >= 0 else { throw IdentityError.filesystem(errno) }
      defer { close(lock) }
      let deadline = ProcessInfo.processInfo.systemUptime + 1
      try lease?.checkCancellation()
      while flock(lock, LOCK_EX | LOCK_NB) != 0 {
        guard errno == EWOULDBLOCK, ProcessInfo.processInfo.systemUptime < deadline else {
          throw IdentityError.filesystem(errno)
        }
        try lease?.checkCancellation()
        Thread.sleep(forTimeInterval: 0.02)
      }
      defer { flock(lock, LOCK_UN) }
      let sentinel = directory.appendingPathComponent("installation")
      let hasSentinel = FileManager.default.fileExists(atPath: sentinel.path)
      func remember(_ id: UUID) throws -> UUID {
        try Data(id.uuidString.lowercased().utf8).write(to: sentinel, options: .atomic)
        #if os(iOS)
          try FileManager.default.setAttributes(
            [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication],
            ofItemAtPath: sentinel.path)
        #endif
        return id
      }
      var query: [String: Any] = [
        kSecClass as String: kSecClassGenericPassword,
        kSecAttrService as String: service,
        kSecAttrAccount as String: "installation-v1",
        kSecAttrSynchronizable as String: false,
      ]
      if let accessGroup { query[kSecAttrAccessGroup as String] = accessGroup }
      func read() throws -> UUID? {
        var request = query
        request[kSecReturnData as String] = true
        request[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        let status = SecItemCopyMatching(request as CFDictionary, &item)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = item as? Data,
          let text = String(data: data, encoding: .utf8), let id = UUID(uuidString: text)
        else { throw IdentityError.keychain(status) }
        return id
      }
      let existing = try read()
      if hasSentinel, let existing { return existing }
      // Keychain entries can survive uninstall; a missing non-backed-up sentinel starts a new source.
      if existing != nil {
        let replacement = UUID()
        let status = SecItemUpdate(
          query as CFDictionary,
          [kSecValueData as String: Data(replacement.uuidString.lowercased().utf8)] as CFDictionary)
        guard status == errSecSuccess else { throw IdentityError.keychain(status) }
        return try remember(replacement)
      }
      let created = UUID()
      var insertion = query
      insertion[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
      insertion[kSecValueData as String] = Data(created.uuidString.lowercased().utf8)
      let status = SecItemAdd(insertion as CFDictionary, nil)
      if status == errSecSuccess { return try remember(created) }
      if status == errSecDuplicateItem, let winner = try read() { return try remember(winner) }
      throw IdentityError.keychain(status)
    }
  }
}

public enum IdentityError: Error {
  case keychain(OSStatus)
  case filesystem(Int32)
}

extension SQLiteConnection {
  func retireInstallation(_ source: String, reason: InterruptionReason = .transferAway) throws {
    guard let device = UUID(uuidString: source),
      let raw = try rows(
        "SELECT next_sequence FROM source_state WHERE device_id=?", [.text(source)]
      ).first?["next_sequence"],
      let sequence = Int64(raw)
    else { throw StoreError.invalidInput }
    let reset = try rows(
      "SELECT revision,reset_id FROM reset_markers ORDER BY revision DESC,reset_id DESC LIMIT 1"
    ).first
    let generation: ResetGeneration
    if let reset, let revision = Int64(reset["revision"]!),
      let id = UUID(uuidString: reset["reset_id"]!)
    {
      generation = ResetGeneration(revision: revision, resetID: id)
    } else {
      generation = .initial
    }
    let marker = TrackingInterruption(
      interruptionID: UUID(), deviceID: device, generation: generation,
      afterSequence: sequence - 1, reason: reason,
      observedAtMS: Int64(Date().timeIntervalSince1970 * 1000))
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
    let json = String(decoding: try encoder.encode(marker), as: UTF8.self)
    try execute(
      "INSERT INTO interruptions VALUES (?,?,?,?,?)",
      [
        .text(marker.interruptionID.uuidString.lowercased()),
        .text(source), .text(generation.resetID.uuidString.lowercased()),
        .integer(marker.afterSequence), .text(json),
      ])
    try execute(
      "INSERT INTO work_outbox(work_id,kind,entity_id,generation_id) VALUES (?,'mirror_interruption',?,?)",
      [
        .text(UUID().uuidString.lowercased()), .text(marker.interruptionID.uuidString.lowercased()),
        .text(generation.resetID.uuidString.lowercased()),
      ])
  }
}
