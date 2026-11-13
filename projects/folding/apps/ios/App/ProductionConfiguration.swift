import Foundation

/// Shipping identity is selected at archive time. Missing/partial values fail closed;
/// cloud or network failures never change this identity or select development storage.
struct ProductionConfiguration: Equatable, Sendable {
  let bundleID: String
  let environment: String
  let appGroup: String
  let cloudContainer: String
  let apiOrigin: URL
  let apnsEnvironment: String
  let attestEnvironment: String
  let iCloudEnvironment: String

  private static let keys = [
    "FoldingEnvironment", "FoldingAppGroupIdentifier", "FoldingCloudContainerIdentifier",
    "FoldingAPIOrigin", "FoldingAPNSEnvironment", "FoldingAttestEnvironment",
    "FoldingICloudEnvironment",
  ]

  static func current() throws -> Self? {
    let bundle = Bundle.main
    let values = keys.reduce(into: [String: String]()) { result, key in
      result[key] = bundle.object(forInfoDictionaryKey: key) as? String ?? ""
    }
    #if DEBUG && targetEnvironment(simulator)
      // Only the unsigned-development composition can use its isolated local journal.
      // A partial shipping configuration is an error, even in Debug.
      if values.values.allSatisfy(\.isEmpty) { return nil }
    #endif
    guard let bundleID = bundle.bundleIdentifier else {
      throw CloudTrackingError.missingConfiguration
    }
    #if DEBUG
      let permitsDevelopmentSigning = true
    #else
      let permitsDevelopmentSigning = false
    #endif
    return try Self(
      bundleID: bundleID, values: values,
      permitsDevelopmentSigning: permitsDevelopmentSigning)
  }

  init(bundleID: String, values: [String: String], permitsDevelopmentSigning: Bool = false) throws {
    guard let environment = values["FoldingEnvironment"],
      environment == "production"
    else { throw CloudTrackingError.missingConfiguration }
    let expectedBundle = "app.getfolding.Folding"
    let appGroup = "group.\(expectedBundle)"
    let cloudContainer = "iCloud.\(expectedBundle)"
    let expectedOrigin = "https://api.getfolding.app"
    guard bundleID == expectedBundle, values["FoldingAppGroupIdentifier"] == appGroup,
      values["FoldingCloudContainerIdentifier"] == cloudContainer,
      values["FoldingAPIOrigin"] == expectedOrigin,
      let origin = URL(string: expectedOrigin),
      let apns = values["FoldingAPNSEnvironment"],
      let attest = values["FoldingAttestEnvironment"],
      let cloud = values["FoldingICloudEnvironment"]
    else { throw CloudTrackingError.missingConfiguration }
    let distribution = apns == "production" && attest == "production" && cloud == "Production"
    let development = apns == "development" && attest == "development" && cloud == "Development"
    guard distribution || (permitsDevelopmentSigning && development) else {
      throw CloudTrackingError.missingConfiguration
    }
    self.bundleID = bundleID
    self.environment = environment
    self.appGroup = appGroup
    self.cloudContainer = cloudContainer
    apiOrigin = origin
    apnsEnvironment = apns
    attestEnvironment = attest
    iCloudEnvironment = cloud
  }
}
