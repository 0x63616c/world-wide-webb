import AVFoundation
import CoreAudio
import CallkeepCore

struct CaptureError: LocalizedError {
    let message: String
    var errorDescription: String? { message }
}

@MainActor
final class AudioCapture {
    private let systemTap = SystemAudioTap()
    private var engine: AVAudioEngine?
    private(set) var microphone: TrackWriter?
    private(set) var system: TrackWriter?
    private(set) var deviceIDs: [AudioObjectID] = []

    var microphoneRunning: Bool { engine?.isRunning == true }

    func start(folder: URL, epoch: TimeInterval) throws {
        do {
            let systemWriter = TrackWriter(url: folder.appendingPathComponent("system-audio.caf"), epoch: epoch)
            system = systemWriter
            try systemTap.start { buffer, timestamp in systemWriter.append(buffer, at: timestamp) }

            let micWriter = TrackWriter(url: folder.appendingPathComponent("microphone.caf"), epoch: epoch)
            microphone = micWriter
            let engine = AVAudioEngine()
            self.engine = engine
            let input = engine.inputNode
            let micFormat = input.outputFormat(forBus: 0)
            guard micFormat.sampleRate > 0 && micFormat.channelCount > 0 else { throw CaptureError(message: "No microphone is available. Choose an input in System Settings → Sound.") }
            input.installTap(onBus: 0, bufferSize: 2048, format: micFormat) { buffer, time in
                micWriter.append(buffer, at: time.isHostTimeValid ? AVAudioTime.seconds(forHostTime: time.hostTime) : ProcessInfo.processInfo.systemUptime)
            }
            engine.prepare()
            try engine.start()
            deviceIDs = Self.currentDeviceIDs
        } catch { _ = stop(); throw error }
    }
    func stop() -> (microphone: AudioTrack?, system: AudioTrack?) {
        if let engine { engine.stop(); engine.inputNode.removeTap(onBus: 0); self.engine = nil }
        systemTap.stop()
        let tracks = (microphone?.finish(), system?.finish())
        microphone = nil; system = nil
        return tracks
    }
    static var currentDeviceIDs: [AudioObjectID] {
        [defaultDevice(kAudioHardwarePropertyDefaultInputDevice), defaultDevice(kAudioHardwarePropertyDefaultOutputDevice)]
    }
    static func defaultDevice(_ selector: AudioObjectPropertySelector) -> AudioObjectID {
        var address = AudioObjectPropertyAddress(mSelector: selector, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
        var result: AudioObjectID = 0; var size = UInt32(MemoryLayout<AudioObjectID>.size)
        AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size, &result)
        return result
    }
    private func check(_ status: OSStatus, _ message: String) throws {
        guard status == noErr else { throw CaptureError(message: "\(message) (\(status))") }
    }
}
