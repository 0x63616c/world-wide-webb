import ActivityKit
import Foundation

@available(iOS 16.2, *)
public struct NextAlarmAttributes: ActivityAttributes {
  public struct ContentState: Codable, Hashable {
    public var label: String
    public var fireAt: Date
    public var updatedAt: Date
  }
  public var alarmID: String
}
