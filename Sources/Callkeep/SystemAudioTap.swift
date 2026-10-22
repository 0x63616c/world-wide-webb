import AVFoundation
import CoreAudio

@MainActor
final class SystemAudioTap {
    private var tap: AudioObjectID = 0
    private var aggregate: AudioObjectID = 0
    private var io: AudioDeviceIOProcID?
    private let audioQueue = DispatchQueue(label: "co.calum.callkeep.system-audio", qos: .userInitiated)
    func start(handler: @escaping @Sendable (AVAudioPCMBuffer, TimeInterval) -> Void) throws {
        do {
            let description = CATapDescription(stereoGlobalTapButExcludeProcesses: [])
            description.name = "Callkeep computer audio"
            description.uuid = UUID()
            description.isPrivate = true
            description.muteBehavior = .unmuted
            try check(AudioHardwareCreateProcessTap(description, &tap), "Allow Callkeep to record system audio in System Settings → Privacy & Security → Screen & System Audio Recording.")
            var formatDescription = AudioStreamBasicDescription()
            var size = UInt32(MemoryLayout<AudioStreamBasicDescription>.size)
            var address = AudioObjectPropertyAddress(mSelector: kAudioTapPropertyFormat, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
            try check(AudioObjectGetPropertyData(tap, &address, 0, nil, &size, &formatDescription), "Couldn’t read the computer audio format.")
            guard let format = AVAudioFormat(streamDescription: &formatDescription), format.sampleRate > 0 else { throw CaptureError(message: "The output device has no usable audio format.") }
            let outputID = AudioCapture.defaultDevice(kAudioHardwarePropertyDefaultOutputDevice)
            var uid: Unmanaged<CFString>?
            size = UInt32(MemoryLayout<Unmanaged<CFString>?>.size)
            address.mSelector = kAudioDevicePropertyDeviceUID
            try check(AudioObjectGetPropertyData(outputID, &address, 0, nil, &size, &uid), "Couldn’t access the current output device.")
            guard let outputUID = uid?.takeUnretainedValue() else { throw CaptureError(message: "The output device is unavailable.") }
            let config: [String: Any] = [
                kAudioAggregateDeviceNameKey: "Callkeep Capture",
                kAudioAggregateDeviceUIDKey: UUID().uuidString,
                kAudioAggregateDeviceMainSubDeviceKey: outputUID,
                kAudioAggregateDeviceIsPrivateKey: true,
                kAudioAggregateDeviceIsStackedKey: false,
                kAudioAggregateDeviceTapAutoStartKey: true,
                kAudioAggregateDeviceSubDeviceListKey: [[kAudioSubDeviceUIDKey: outputUID]],
                kAudioAggregateDeviceTapListKey: [[kAudioSubTapUIDKey: description.uuid.uuidString, kAudioSubTapDriftCompensationKey: true]]
            ]
            try check(AudioHardwareCreateAggregateDevice(config as CFDictionary, &aggregate), "Couldn’t prepare system audio capture.")
            try check(AudioDeviceCreateIOProcIDWithBlock(&io, aggregate, audioQueue) { _, input, time, _, _ in
                guard let buffer = AVAudioPCMBuffer(pcmFormat: format, bufferListNoCopy: input, deallocator: nil) else { return }
                let timestamp = time.pointee.mFlags.contains(.hostTimeValid) ? AVAudioTime.seconds(forHostTime: time.pointee.mHostTime) : ProcessInfo.processInfo.systemUptime
                handler(buffer, timestamp)
            }, "Couldn’t connect the system audio stream.")
            try check(AudioDeviceStart(aggregate, io), "Couldn’t start computer audio. Check system audio permission.")

        } catch { stop(); throw error }
    }
    func stop() {
        if aggregate != 0 {
            if let io { AudioDeviceStop(aggregate, io); AudioDeviceDestroyIOProcID(aggregate, io) }
            io = nil; AudioHardwareDestroyAggregateDevice(aggregate); aggregate = 0
        }
        if tap != 0 { AudioHardwareDestroyProcessTap(tap); tap = 0 }
        audioQueue.sync {}
    }
    private func check(_ status: OSStatus, _ message: String) throws {
        guard status == noErr else { throw CaptureError(message: "\(message) (\(status))") }
    }
}
