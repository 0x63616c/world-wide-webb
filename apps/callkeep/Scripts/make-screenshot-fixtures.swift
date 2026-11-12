#!/usr/bin/env swift
import AVFoundation
// Generated tones and fictional metadata for README screenshots; no user audio.
import Foundation

let root = URL(
  fileURLWithPath: CommandLine.arguments.dropFirst().first ?? "/tmp/callkeep-screenshot-fixtures",
  isDirectory: true)
let fm = FileManager.default
try fm.createDirectory(at: root, withIntermediateDirectories: true)
guard try fm.contentsOfDirectory(atPath: root.path).isEmpty else {
  fatalError("Choose an empty fixture directory")
}
let rate = 8000.0
let format = AVAudioFormat(standardFormatWithSampleRate: rate, channels: 1)!
let fixtures: [(String, String, String, Int)] = [
  ("00000000-0000-4000-8000-000000000001", "Product review", "2026-11-02T17:00:00Z", 1458),
  ("00000000-0000-4000-8000-000000000002", "Design feedback", "2026-10-30T20:00:00Z", 762),
  ("00000000-0000-4000-8000-000000000003", "Weekly planning", "2026-10-29T21:00:00Z", 2285),
]
for (id, title, date, duration) in fixtures {
  let folder = root.appendingPathComponent(id, isDirectory: true)
  try fm.createDirectory(at: folder, withIntermediateDirectories: true)
  for (file, phase) in [("microphone.caf", 0.0), ("system-audio.caf", 1.7)] {
    let settings: [String: Any] = [
      AVFormatIDKey: kAudioFormatLinearPCM, AVSampleRateKey: rate,
      AVNumberOfChannelsKey: 1, AVLinearPCMBitDepthKey: 16, AVLinearPCMIsFloatKey: false,
      AVLinearPCMIsBigEndianKey: false,
    ]
    let audio = try AVAudioFile(
      forWriting: folder.appendingPathComponent(file), settings: settings,
      commonFormat: .pcmFormatFloat32, interleaved: false)
    let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: UInt32(rate))!
    buffer.frameLength = UInt32(rate)
    for second in 0..<duration {
      let t = Double(second)
      let envelope = 0.025 + 0.55 * max(0, sin(t * 0.39 + phase) * cos(t * 0.13 + phase))
      for frame in 0..<Int(rate) {
        let time = Double(frame) / rate
        buffer.floatChannelData![0][frame] = Float(
          envelope * (0.7 * sin(2 * .pi * 180 * time) + 0.2 * sin(2 * .pi * 390 * time)))
      }
      try audio.write(from: buffer)
    }
  }
  func track(_ file: String) -> [String: Any] {
    ["file": file, "startOffset": 0, "duration": duration, "sampleRate": rate, "channels": 1]
  }
  let metadata: [String: Any] = [
    "id": id, "title": title, "createdAt": date, "duration": duration,
    "state": "saved", "schemaVersion": 1, "microphone": track("microphone.caf"),
    "systemAudio": track("system-audio.caf"),
  ]
  try JSONSerialization.data(withJSONObject: metadata, options: [.prettyPrinted, .sortedKeys])
    .write(to: folder.appendingPathComponent("recording.json"), options: .atomic)
  print("Created fixture: \(title)")
}
