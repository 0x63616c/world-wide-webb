import AppKit
import Carbon
import Observation
import ServiceManagement

@MainActor
protocol LoginItemService {
  var status: SMAppService.Status { get }
  func register() throws
  func unregister() throws
}

extension SMAppService: LoginItemService {}

@MainActor @Observable
final class LaunchAtLogin {
  private(set) var status: SMAppService.Status
  private(set) var error: String?
  let canManage: Bool
  private let service: any LoginItemService
  var enabled: Bool { status == .enabled || status == .requiresApproval }
  init(
    service: any LoginItemService = SMAppService.mainApp, canManage: Bool = AppIdentity.isProduction
  ) {
    self.service = service
    self.canManage = canManage
    status = service.status
  }
  func refresh() { status = service.status }
  func setEnabled(_ enabled: Bool) {
    guard canManage else { return }
    do {
      if enabled { try service.register() } else { try service.unregister() }
      error = nil
    } catch { self.error = error.localizedDescription }
    refresh()
  }
  func openSettings() { SMAppService.openSystemSettingsLoginItems() }
  static func shouldLaunchQuietly(_ event: NSAppleEventDescriptor?) -> Bool {
    guard event?.eventID == kAEOpenApplication else { return false }
    let reason = event?.paramDescriptor(forKeyword: keyAEPropData)?.enumCodeValue
    return reason == keyAELaunchedAsLogInItem || reason == keyAELaunchedAsServiceItem
  }
}
