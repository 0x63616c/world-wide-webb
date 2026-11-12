import AVFoundation
import CallkeepCore
import CoreAudio

struct CaptureError: LocalizedError {
  let message: String
  var errorDescription: String? { message }
}

@MainActor
final class AudioCapture {
  private let systemTap = SystemAudioTap()
  private var engine: AVAudioEngine?
  private var hasMicrophoneTap = false
  private var recoveryAttempts = 0
  private var lastRecovery: TimeInterval = 0
  private(set) var microphone: TrackWriter?
  private(set) var system: TrackWriter?
  private(set) var deviceIDs: [AudioObjectID] = []

  var error: String? { systemTap.error }

  func start(folder: URL, epoch: TimeInterval) throws {
    do {
      microphone = TrackWriter(
        url: folder.appendingPathComponent("microphone.caf"), epoch: epoch,
        format: AVAudioFormat(standardFormatWithSampleRate: 48000, channels: 1), channelMap: [0])
      // Voice processing must be configured first: it can change the Mac's
      // hardware format and exposes processed speech instead of the quiet raw mic array.
      engine = AVAudioEngine()
      try startMicrophone()
      let systemWriter = TrackWriter(
        url: folder.appendingPathComponent("system-audio.caf"), epoch: epoch,
        format: AVAudioFormat(standardFormatWithSampleRate: 48000, channels: 2))
      system = systemWriter
      try systemTap.start { buffer, timestamp in systemWriter.append(buffer, at: timestamp) }
      deviceIDs = Self.currentDeviceIDs
      recoveryAttempts = 0
      lastRecovery = 0
    } catch {
      _ = stop()
      throw error
    }
  }

  private func startMicrophone() throws {
    guard let engine, let microphone else { return }
    engine.stop()
    let input = engine.inputNode
    if hasMicrophoneTap {
      input.removeTap(onBus: 0)
      hasMicrophoneTap = false
    }
    try input.setVoiceProcessingEnabled(true)
    input.isVoiceProcessingBypassed = false
    input.isVoiceProcessingAGCEnabled = true
    input.voiceProcessingOtherAudioDuckingConfiguration = .init(
      enableAdvancedDucking: false, duckingLevel: .min)
    let hardwareFormat = input.outputFormat(forBus: 0)
    guard hardwareFormat.sampleRate > 0, hardwareFormat.channelCount > 0 else {
      throw CaptureError(
        message: "No microphone is available. Choose an input in System Settings → Sound.")
    }
    // Tap the negotiated format; hardware input nodes cannot convert formats.
    // The writer selects the processed uplink channel and resamples off-thread.
    input.installTap(onBus: 0, bufferSize: 2048, format: hardwareFormat) { buffer, time in
      microphone.append(
        buffer,
        at: time.isHostTimeValid
          ? AVAudioTime.seconds(forHostTime: time.hostTime) : ProcessInfo.processInfo.systemUptime)
    }
    hasMicrophoneTap = true
    engine.prepare()
    try engine.start()
  }

  /// Configuration changes stop AVAudioEngine, even when no device disconnected.
  /// Rebuild its tap on the main actor, outside the engine's notification queue.
  func recoverMicrophoneIfNeeded() throws {
    guard let engine else { return }
    let now = ProcessInfo.processInfo.systemUptime
    if engine.isRunning {
      if now - lastRecovery > 10 { recoveryAttempts = 0 }
      return
    }
    guard now - lastRecovery >= 1 else { return }
    guard recoveryAttempts < 3 else {
      throw CaptureError(message: "The microphone couldn’t reconnect. Your recording was saved.")
    }
    lastRecovery = now
    recoveryAttempts += 1
    do { try startMicrophone() } catch {
      if recoveryAttempts >= 3 { throw error }
    }
  }

  func stop() -> (microphone: AudioTrack?, system: AudioTrack?, error: String?) {
    let captureError = error
    if let engine {
      engine.stop()
      if hasMicrophoneTap { engine.inputNode.removeTap(onBus: 0) }
      hasMicrophoneTap = false
      self.engine = nil
    }
    systemTap.stop()
    let micTrack = microphone?.finish()
    let systemTrack = system?.finish()
    let tracks = (
      micTrack, systemTrack, microphone?.snapshot.error ?? system?.snapshot.error ?? captureError
    )
    microphone = nil
    system = nil
    return tracks
  }
  static var currentDeviceIDs: [AudioObjectID] {
    [
      defaultDevice(kAudioHardwarePropertyDefaultInputDevice),
      defaultDevice(kAudioHardwarePropertyDefaultOutputDevice),
    ]
  }
  static func defaultDevice(_ selector: AudioObjectPropertySelector) -> AudioObjectID {
    var address = AudioObjectPropertyAddress(
      mSelector: selector, mScope: kAudioObjectPropertyScopeGlobal,
      mElement: kAudioObjectPropertyElementMain)
    var result: AudioObjectID = 0
    var size = UInt32(MemoryLayout<AudioObjectID>.size)
    AudioObjectGetPropertyData(
      AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size, &result)
    return result
  }
}
