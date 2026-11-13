import AVFoundation

public enum TranscriptionAudio {
  public static let chunkSeconds: Double = 25
  /// Completed audio across both tracks, including checkpoints from an earlier run.
  public static func progress(recording: Recording, nextChunks: [TranscriptSource: Int]) -> Double?
  {
    var total = 0.0
    var completed = 0.0
    for (source, track) in [
      (TranscriptSource.microphone, recording.microphone), (.systemAudio, recording.systemAudio),
    ] {
      guard let track else { continue }
      guard track.duration.isFinite, track.duration >= 0 else { return nil }
      total += track.duration
      completed += min(track.duration, Double(max(0, nextChunks[source] ?? 0)) * chunkSeconds)
    }
    return total > 0 ? min(1, completed / total) : nil
  }
  /// Read only one bounded chunk, downmix every channel, and convert to 16 kHz.
  public static func read(url: URL, chunk: Int) throws -> [Float] {
    let file = try AVAudioFile(forReading: url)
    let input = file.processingFormat
    file.framePosition = min(
      file.length, AVAudioFramePosition(Double(chunk) * chunkSeconds * input.sampleRate))
    let count = AVAudioFrameCount(
      min(file.length - file.framePosition, AVAudioFramePosition(chunkSeconds * input.sampleRate)))
    guard count > 0 else { return [] }
    guard let source = AVAudioPCMBuffer(pcmFormat: input, frameCapacity: count) else {
      throw CocoaError(.fileReadCorruptFile)
    }
    try file.read(into: source, frameCount: count)
    let monoFormat = AVAudioFormat(standardFormatWithSampleRate: input.sampleRate, channels: 1)!
    let mono = AVAudioPCMBuffer(pcmFormat: monoFormat, frameCapacity: source.frameLength)!
    mono.frameLength = source.frameLength
    guard let channels = source.floatChannelData else { throw CocoaError(.fileReadCorruptFile) }
    for frame in 0..<Int(source.frameLength) {
      var value: Float = 0
      for channel in 0..<Int(input.channelCount) {
        value += channels[channel][frame] / Float(input.channelCount)
      }
      mono.floatChannelData![0][frame] = value.isFinite ? value : 0
    }
    let outputFormat = AVAudioFormat(standardFormatWithSampleRate: 16000, channels: 1)!
    let output = AVAudioPCMBuffer(
      pcmFormat: outputFormat,
      frameCapacity: AVAudioFrameCount(ceil(Double(mono.frameLength) * 16000 / input.sampleRate))
        + 32)!
    guard let converter = AVAudioConverter(from: monoFormat, to: outputFormat) else {
      throw CocoaError(.fileReadCorruptFile)
    }
    var supplied = false
    var error: NSError?
    let status = converter.convert(to: output, error: &error) { _, state in
      if supplied {
        state.pointee = .endOfStream
        return nil
      }
      supplied = true
      state.pointee = .haveData
      return mono
    }
    if let error { throw error }
    guard status != .error else { throw CocoaError(.fileReadCorruptFile) }
    return Array(
      UnsafeBufferPointer(start: output.floatChannelData![0], count: Int(output.frameLength)))
  }
  public static func isSilent(_ samples: [Float]) -> Bool {
    guard !samples.isEmpty else { return true }
    // Skip digital silence; low-level speech remains eligible for recognition.
    return samples.allSatisfy { abs($0) < 0.00002 }
  }
  public static func aligned(
    text: String, source: TranscriptSource, start: Double, end: Double,
    chunk: Int, track: AudioTrack
  ) -> TranscriptSegment? {
    let text = text.trimmingCharacters(in: .whitespacesAndNewlines)
    let chunkStart = Double(chunk) * chunkSeconds
    let remaining = max(0, min(chunkSeconds, track.duration - chunkStart))
    guard !text.isEmpty, start.isFinite, end.isFinite, start < remaining else { return nil }
    let begin = max(0, start)
    let finish = max(begin, min(end, remaining))
    return TranscriptSegment(
      source: source, start: track.startOffset + chunkStart + begin,
      end: track.startOffset + chunkStart + finish, text: text)
  }
}
