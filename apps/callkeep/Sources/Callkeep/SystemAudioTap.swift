import AVFoundation
import CoreAudio

// Accessed only on audioQueue, shared by the format listener and IO callback.
private final class TapStreamState: @unchecked Sendable {
  var format: AVAudioFormat?
  var error: String?
}

@MainActor
final class SystemAudioTap {
  private var tap: AudioObjectID = 0
  private var aggregate: AudioObjectID = 0
  private var io: AudioDeviceIOProcID?
  private var formatListener: AudioObjectPropertyListenerBlock?
  private let stream = TapStreamState()
  private let audioQueue = DispatchQueue(
    label: "co.calum.callkeep.system-audio", qos: .userInitiated)
  nonisolated private static var formatAddress: AudioObjectPropertyAddress {
    AudioObjectPropertyAddress(
      mSelector: kAudioDevicePropertyStreamFormat, mScope: kAudioObjectPropertyScopeInput,
      mElement: kAudioObjectPropertyElementMain)
  }
  var error: String? { audioQueue.sync { stream.error } }

  func start(handler: @escaping @Sendable (AVAudioPCMBuffer, TimeInterval) -> Void) throws {
    do {
      let description = CATapDescription(stereoGlobalTapButExcludeProcesses: [])
      description.name = "Callkeep computer audio"
      description.uuid = UUID()
      description.isPrivate = true
      description.muteBehavior = .unmuted
      try check(
        AudioHardwareCreateProcessTap(description, &tap),
        "Allow Callkeep to record system audio in System Settings → Privacy & Security → Screen & System Audio Recording."
      )
      // A tap-only aggregate avoids accidentally capturing a headset's input
      // channels before the tap, and lets Core Audio manage the tap's clock.
      let config: [String: Any] = [
        kAudioAggregateDeviceNameKey: "Callkeep Capture",
        kAudioAggregateDeviceUIDKey: UUID().uuidString,
        kAudioAggregateDeviceIsPrivateKey: true,
        kAudioAggregateDeviceIsStackedKey: false,
        kAudioAggregateDeviceTapAutoStartKey: true,
        kAudioAggregateDeviceSubDeviceListKey: [],
        kAudioAggregateDeviceTapListKey: [
          [kAudioSubTapUIDKey: description.uuid.uuidString, kAudioSubTapDriftCompensationKey: true]
        ],
      ]
      try check(
        AudioHardwareCreateAggregateDevice(config as CFDictionary, &aggregate),
        "Couldn’t prepare system audio capture.")
      let device = aggregate
      let stream = stream
      // The IO callback delivers the AGGREGATE's format, which can differ
      // from kAudioTapPropertyFormat (notably 44.1 kHz versus 48 kHz).
      let readFormat: @Sendable () -> Void = {
        var address = Self.formatAddress
        var asbd = AudioStreamBasicDescription()
        var size = UInt32(MemoryLayout<AudioStreamBasicDescription>.size)
        let status = AudioObjectGetPropertyData(device, &address, 0, nil, &size, &asbd)
        guard status == noErr, asbd.mSampleRate > 0, asbd.mChannelsPerFrame == 2,
          let format = AVAudioFormat(streamDescription: &asbd)
        else {
          stream.format = nil
          stream.error = "The computer audio format is unavailable. Your recording was saved."
          return
        }
        stream.format = format
        stream.error = nil
      }
      audioQueue.sync { readFormat() }
      if let error { throw CaptureError(message: error) }
      let listener: AudioObjectPropertyListenerBlock = { _, _ in readFormat() }
      formatListener = listener
      var address = Self.formatAddress
      try check(
        AudioObjectAddPropertyListenerBlock(device, &address, audioQueue, listener),
        "Couldn’t monitor the computer audio format.")
      try check(
        AudioDeviceCreateIOProcIDWithBlock(&io, device, audioQueue) { _, input, time, _, _ in
          guard let format = stream.format,
            let buffer = AVAudioPCMBuffer(
              pcmFormat: format, bufferListNoCopy: input, deallocator: nil)
          else { return }
          let timestamp =
            time.pointee.mFlags.contains(.hostTimeValid)
            ? AVAudioTime.seconds(forHostTime: time.pointee.mHostTime)
            : ProcessInfo.processInfo.systemUptime
          handler(buffer, timestamp)
        }, "Couldn’t connect the system audio stream.")
      try check(
        AudioDeviceStart(device, io),
        "Couldn’t start computer audio. Check system audio permission.")
    } catch {
      stop()
      throw error
    }
  }
  func stop() {
    if aggregate != 0 {
      if let io {
        AudioDeviceStop(aggregate, io)
        AudioDeviceDestroyIOProcID(aggregate, io)
      }
      if let formatListener {
        var address = Self.formatAddress
        AudioObjectRemovePropertyListenerBlock(aggregate, &address, audioQueue, formatListener)
      }
      formatListener = nil
      io = nil
      AudioHardwareDestroyAggregateDevice(aggregate)
      aggregate = 0
    }
    if tap != 0 {
      AudioHardwareDestroyProcessTap(tap)
      tap = 0
    }
    audioQueue.sync {
      stream.format = nil
      stream.error = nil
    }
  }
  private func check(_ status: OSStatus, _ message: String) throws {
    guard status == noErr else { throw CaptureError(message: "\(message) (\(status))") }
  }
}
