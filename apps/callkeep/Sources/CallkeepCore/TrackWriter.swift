@preconcurrency import AVFoundation
import Foundation

/// Audio callbacks enqueue owned copies; disk IO and conversion stay off the render thread.
public final class TrackWriter: @unchecked Sendable {
  private let queue = DispatchQueue(label: "co.calum.callkeep.track-writer", qos: .userInitiated)
  private let lock = NSLock()
  private var pending = 0
  private var failure: String?
  private var level: Float = 0
  private var meterPeak: Float = 0
  private var converter: AVAudioConverter?
  private let targetFormat: AVAudioFormat?
  private let channelMap: [NSNumber]?
  private var converterInputFrames: Int64 = 0
  private var converterOutputFrames: Int64 = 0
  private var firstOffset: TimeInterval?
  private var expectedInputEnd: TimeInterval?
  private var file: AVAudioFile?
  private var framesWritten: AVAudioFramePosition = 0
  private let url: URL
  private let epoch: TimeInterval

  public init(
    url: URL, epoch: TimeInterval, format: AVAudioFormat? = nil, channelMap: [NSNumber]? = nil
  ) {
    self.url = url
    self.epoch = epoch
    self.targetFormat = format
    self.channelMap = channelMap
  }
  public func append(_ source: AVAudioPCMBuffer, at timestamp: TimeInterval) {
    guard source.frameLength > 0 else { return }
    lock.lock()
    if pending >= 128 {
      failure = "The disk couldn’t keep up with recording."
      lock.unlock()
      return
    }
    pending += 1
    lock.unlock()
    guard let copy = AVAudioPCMBuffer(pcmFormat: source.format, frameCapacity: source.frameLength)
    else {
      lock.lock()
      pending -= 1
      failure = "Couldn’t allocate an audio buffer."
      lock.unlock()
      return
    }
    copy.frameLength = source.frameLength
    let input = UnsafeMutableAudioBufferListPointer(
      UnsafeMutablePointer(mutating: source.audioBufferList))
    let output = UnsafeMutableAudioBufferListPointer(copy.mutableAudioBufferList)
    for i in 0..<min(input.count, output.count) {
      if let from = input[i].mData, let to = output[i].mData {
        memcpy(to, from, Int(input[i].mDataByteSize))
      }
    }
    queue.async { [self, copy] in
      defer {
        lock.lock()
        pending -= 1
        lock.unlock()
      }
      do { try write(copy, at: timestamp) } catch {
        lock.lock()
        failure = error.localizedDescription
        lock.unlock()
      }
    }
  }

  private func write(_ input: AVAudioPCMBuffer, at timestamp: TimeInterval) throws {
    if file == nil {
      let format = targetFormat ?? input.format
      file = try AVAudioFile(
        forWriting: url,
        settings: [
          AVFormatIDKey: kAudioFormatLinearPCM, AVSampleRateKey: format.sampleRate,
          AVNumberOfChannelsKey: format.channelCount, AVLinearPCMBitDepthKey: 16,
          AVLinearPCMIsFloatKey: false, AVLinearPCMIsBigEndianKey: false,
        ], commonFormat: format.commonFormat, interleaved: format.isInterleaved)
      firstOffset = max(0, timestamp - epoch)
    }
    guard let file else { return }
    let hasGap = expectedInputEnd.map { timestamp - $0 > 0.005 } ?? false
    if hasGap || (converter != nil && converter?.inputFormat != input.format) {
      try flushConverter()
    }
    // Compare SOURCE timing. A streaming resampler retains a short filter
    // tail; that latency is not missing audio and must never become silence.
    if hasGap, let firstOffset {
      let targetFrame = AVAudioFramePosition(
        max(0, timestamp - epoch - firstOffset) * file.processingFormat.sampleRate)
      var gap = max(0, targetFrame - framesWritten)
      if gap > 0,
        let silence = AVAudioPCMBuffer(pcmFormat: file.processingFormat, frameCapacity: 4096)
      {
        silence.frameLength = 4096
        for buffer in UnsafeMutableAudioBufferListPointer(silence.mutableAudioBufferList) {
          if let data = buffer.mData { memset(data, 0, Int(buffer.mDataByteSize)) }
        }
        while gap > 0 {
          silence.frameLength = AVAudioFrameCount(min(gap, 4096))
          try appendToFile(silence)
          gap -= AVAudioFramePosition(silence.frameLength)
        }
      }
    }
    expectedInputEnd = timestamp + Double(input.frameLength) / input.format.sampleRate
    let converted = try convert(input)
    guard converted.format == file.processingFormat else {
      throw failureError("The audio device format changed. Start a new recording.")
    }
    try appendToFile(converted)
    var peak: Float = 0
    if let channels = converted.floatChannelData {
      let channelCount = converted.format.isInterleaved ? 1 : Int(converted.format.channelCount)
      let count =
        Int(converted.frameLength)
        * (converted.format.isInterleaved ? Int(converted.format.channelCount) : 1)
      for channel in 0..<channelCount {
        for index in 0..<count { peak = max(peak, abs(channels[channel][index])) }
      }
    }
    lock.lock()
    level = peak
    meterPeak = max(meterPeak, peak)
    lock.unlock()
  }
  private func appendToFile(_ buffer: AVAudioPCMBuffer) throws {
    guard buffer.frameLength > 0 else { return }
    try file?.write(from: buffer)
    framesWritten += AVAudioFramePosition(buffer.frameLength)
  }
  private func convert(_ input: AVAudioPCMBuffer) throws -> AVAudioPCMBuffer {
    guard let targetFormat, input.format != targetFormat else { return input }
    if converter == nil {
      converter = AVAudioConverter(from: input.format, to: targetFormat)
      converter?.sampleRateConverterQuality = AVAudioQuality.max.rawValue
      converter?.primeMethod = .none
      if let channelMap { converter?.channelMap = channelMap }
      converterInputFrames = 0
      converterOutputFrames = 0
    }
    guard let converter,
      let output = AVAudioPCMBuffer(
        pcmFormat: targetFormat,
        frameCapacity: AVAudioFrameCount(
          ceil(Double(input.frameLength) * targetFormat.sampleRate / input.format.sampleRate)) + 64)
    else {
      throw failureError("Couldn’t convert the audio format.")
    }
    converterInputFrames += Int64(input.frameLength)
    var supplied = false
    var error: NSError?
    let status = converter.convert(to: output, error: &error) { _, state in
      if supplied {
        state.pointee = .noDataNow
        return nil
      }
      supplied = true
      state.pointee = .haveData
      return input
    }
    if let error { throw error }
    if status == .error { throw failureError("Couldn’t convert the audio samples.") }
    converterOutputFrames += Int64(output.frameLength)
    return output
  }
  private func flushConverter() throws {
    guard let converter, let targetFormat else { return }
    defer { self.converter = nil }
    guard let output = AVAudioPCMBuffer(pcmFormat: targetFormat, frameCapacity: 4096) else {
      throw failureError("Couldn’t finish converting audio.")
    }
    let expectedFrames = Int64(
      (Double(converterInputFrames) * targetFormat.sampleRate / converter.inputFormat.sampleRate)
        .rounded())
    while converterOutputFrames < expectedFrames {
      var error: NSError?
      let status = converter.convert(to: output, error: &error) { _, state in
        state.pointee = .endOfStream
        return nil
      }
      if let error { throw error }
      if status == .error { throw failureError("Couldn’t finish converting audio.") }
      // End-of-stream flushing also emits the filter's trailing padding.
      // Keep only the duration represented by actual input samples.
      output.frameLength = AVAudioFrameCount(
        min(Int64(output.frameLength), expectedFrames - converterOutputFrames))
      try appendToFile(output)
      converterOutputFrames += Int64(output.frameLength)
      if status == .endOfStream || output.frameLength == 0 { break }
    }
  }
  private func failureError(_ message: String) -> NSError {
    NSError(domain: "Callkeep", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
  }
  /// Peak since the previous UI sample; returns zero if callbacks pause.
  public func takeLevel() -> Float {
    lock.lock()
    defer { lock.unlock() }
    let result = meterPeak
    meterPeak = 0
    return result
  }
  public var snapshot: (level: Float, error: String?) {
    lock.lock()
    defer { lock.unlock() }
    return (level, failure)
  }
  public func finish() -> AudioTrack? {
    queue.sync {
      do { try flushConverter() } catch {
        lock.lock()
        failure = error.localizedDescription
        lock.unlock()
      }
      file = nil
      return RecordingStore.inspect(url, offset: firstOffset ?? 0)
    }
  }
  public var track: AudioTrack? {
    queue.sync {
      guard let file else { return nil }
      return AudioTrack(
        file: url.lastPathComponent, startOffset: firstOffset ?? 0,
        duration: Double(framesWritten) / file.fileFormat.sampleRate,
        sampleRate: file.fileFormat.sampleRate, channels: file.fileFormat.channelCount)
    }
  }
}
