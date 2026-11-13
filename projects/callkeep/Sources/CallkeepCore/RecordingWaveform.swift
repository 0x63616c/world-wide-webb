import AVFoundation
import Foundation

/// Aligned envelopes retain the two source identities on the recording timeline.
public struct RecordingWaveform: Equatable, Sendable {
  public let microphone: [Float]
  public let systemAudio: [Float]
  public init(microphone: [Float] = [], systemAudio: [Float] = []) {
    self.microphone = microphone
    self.systemAudio = systemAudio
  }

  public static func read(_ recording: Recording, folder: URL, bins: Int = 160) throws -> Self {
    guard bins > 0, recording.duration.isFinite, recording.duration > 0 else { return Self() }
    func envelope(_ track: AudioTrack?) throws -> [Float] {
      var peaks = Array(repeating: Float(0), count: bins)
      guard let track, track.startOffset.isFinite,
        let file = try? AVAudioFile(forReading: folder.appendingPathComponent(track.file)),
        let buffer = AVAudioPCMBuffer(pcmFormat: file.processingFormat, frameCapacity: 8192)
      else { return peaks }
      let rate = file.processingFormat.sampleRate
      while file.framePosition < file.length {
        try Task.checkCancellation()
        let firstFrame = file.framePosition
        try file.read(into: buffer)
        guard buffer.frameLength > 0, let channels = buffer.floatChannelData else { break }
        for frame in 0..<Int(buffer.frameLength) {
          let time = track.startOffset + Double(firstFrame + Int64(frame)) / rate
          guard time >= 0, time < recording.duration else { continue }
          let bin = min(bins - 1, Int(time / recording.duration * Double(bins)))
          for channel in 0..<Int(buffer.format.channelCount) {
            let value = abs(channels[channel][frame])
            if value.isFinite { peaks[bin] = max(peaks[bin], value) }
          }
        }
      }
      return peaks
    }
    return try Self(
      microphone: envelope(recording.microphone), systemAudio: envelope(recording.systemAudio))
  }
}
