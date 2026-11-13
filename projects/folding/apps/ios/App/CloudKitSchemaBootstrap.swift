#if DEBUG
  import CloudKit
  import FoldingData
  import Foundation
  import SwiftUI

  /// Explicit developer launch mode. This never starts the normal app's tracking tasks.
  @MainActor struct CloudKitSchemaBootstrapView: View {
    static var requested: Bool {
      ProcessInfo.processInfo.arguments.contains("--folding-initialize-cloudkit-schema")
    }
    @State private var status = "Initializing development schema…"
    @State private var started = false

    var body: some View {
      ContentUnavailableView(
        "CloudKit schema", systemImage: "externaldrive.badge.icloud", description: Text(status)
      )
      .task {
        guard !started else { return }
        started = true
        do {
          try await initialize()
          status = "Development schema initialized. Export the schema and receipt before promotion."
        } catch {
          // Do not render CloudKit errors containing account/record information.
          status = "Schema initialization failed. Check development signing and iCloud access."
        }
      }
    }

    private func initialize() async throws {
      guard let configuration = try ProductionConfiguration.current(),
        configuration.iCloudEnvironment == "Development",
        configuration.attestEnvironment == "development",
        configuration.apnsEnvironment == "development",
        let commit = Bundle.main.object(forInfoDictionaryKey: "FoldingSourceCommit") as? String,
        commit.count == 40, commit.allSatisfy({ "0123456789abcdef".contains($0) })
      else { throw CloudTrackingError.missingConfiguration }
      let cloud = CKContainer(identifier: configuration.cloudContainer)
      guard try await cloud.accountStatus() == .available else {
        throw CloudTrackingError.accountUnavailable
      }
      let temporary = FileManager.default.temporaryDirectory.appendingPathComponent(
        "FoldingSchemaBootstrap-\(UUID())", isDirectory: true)
      defer { try? FileManager.default.removeItem(at: temporary) }
      let mirror = try await PrivateCloudMirror(
        directory: temporary, containerIdentifier: configuration.cloudContainer)
      let description: PrivateCloudSchemaDescription
      do {
        description = try await mirror.initializeDevelopmentSchema()
        try await mirror.close()
      } catch {
        try? await mirror.close()
        throw error
      }
      struct Receipt: Encodable {
        let formatVersion = 1
        let commit: String
        let container: String
        let environment = "development"
        let initializedAt: Date
        let model: PrivateCloudSchemaDescription
      }
      let receipt = Receipt(
        commit: commit, container: configuration.cloudContainer, initializedAt: Date(),
        model: description)
      let encoder = JSONEncoder()
      encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
      encoder.dateEncodingStrategy = .iso8601
      let documents = try FileManager.default.url(
        for: .documentDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
      try encoder.encode(receipt).write(
        to: documents.appendingPathComponent("cloudkit-schema-bootstrap.json"),
        options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }
  }
#endif
