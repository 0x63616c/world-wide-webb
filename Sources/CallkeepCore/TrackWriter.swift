import Foundation
@preconcurrency import AVFoundation

/// Audio callbacks enqueue owned copies; disk IO never runs on the microphone render thread.
public final class TrackWriter: @unchecked Sendable {
    private let queue = DispatchQueue(label: "co.calum.callkeep.track-writer", qos: .userInitiated)
    private let lock = NSLock()
    private var pending = 0
    private var failure: String?
    private var level: Float = 0
    private var firstOffset: TimeInterval?
    private var file: AVAudioFile?
    private var framesWritten: AVAudioFramePosition = 0
    private let url: URL
    private let epoch: TimeInterval
    public init(url: URL, epoch: TimeInterval) { self.url = url; self.epoch = epoch }
    public func append(_ source: AVAudioPCMBuffer, at timestamp: TimeInterval) {
        guard source.frameLength > 0 else { return }
        lock.lock()
        if pending >= 128 { failure = "The disk couldn’t keep up with recording."; lock.unlock(); return }
        pending += 1; lock.unlock()
        guard let copy = AVAudioPCMBuffer(pcmFormat: source.format, frameCapacity: source.frameLength) else {
            lock.lock(); pending -= 1; failure = "Couldn’t allocate an audio buffer."; lock.unlock(); return
        }
        copy.frameLength = source.frameLength
        let input = UnsafeMutableAudioBufferListPointer(UnsafeMutablePointer(mutating: source.audioBufferList))
        let output = UnsafeMutableAudioBufferListPointer(copy.mutableAudioBufferList)
        for i in 0..<min(input.count, output.count) {
            if let from = input[i].mData, let to = output[i].mData {
                memcpy(to, from, Int(input[i].mDataByteSize))
            }
        }
        queue.async { [self, copy] in
            defer { lock.lock(); pending -= 1; lock.unlock() }
            do {
                if file == nil {
                    file = try AVAudioFile(forWriting: url, settings: [AVFormatIDKey: kAudioFormatLinearPCM, AVSampleRateKey: copy.format.sampleRate, AVNumberOfChannelsKey: copy.format.channelCount, AVLinearPCMBitDepthKey: 16, AVLinearPCMIsFloatKey: false, AVLinearPCMIsBigEndianKey: false], commonFormat: copy.format.commonFormat, interleaved: copy.format.isInterleaved)
                    firstOffset = max(0, timestamp - epoch)
                }
                guard file?.processingFormat == copy.format else { throw NSError(domain: "Callkeep", code: 1, userInfo: [NSLocalizedDescriptionKey: "The audio device format changed. Start a new recording."]) }
                // System audio can suspend its callbacks during silence. Preserve the
                // shared timeline instead of collapsing these gaps out of the file.
                if let file, let firstOffset {
                    let targetFrame = AVAudioFramePosition(max(0, timestamp - epoch - firstOffset) * copy.format.sampleRate)
                    var gap = targetFrame - framesWritten
                    if gap > AVAudioFramePosition(copy.format.sampleRate * 0.005),
                       let silence = AVAudioPCMBuffer(pcmFormat: copy.format, frameCapacity: 4096) {
                        for buffer in UnsafeMutableAudioBufferListPointer(silence.mutableAudioBufferList) {
                            if let data = buffer.mData { memset(data, 0, Int(buffer.mDataByteSize)) }
                        }
                        while gap > 0 {
                            silence.frameLength = AVAudioFrameCount(min(gap, 4096))
                            try file.write(from: silence)
                            gap -= AVAudioFramePosition(silence.frameLength)
                            framesWritten += AVAudioFramePosition(silence.frameLength)
                        }
                    }
                }
                try file?.write(from: copy)
                framesWritten += AVAudioFramePosition(copy.frameLength)
                var peak: Float = 0
                if let channels = copy.floatChannelData {
                    let count = Int(copy.frameLength) * (copy.format.isInterleaved ? Int(copy.format.channelCount) : 1)
                    for index in 0..<count { peak = max(peak, abs(channels[0][index])) }
                }
                lock.lock(); level = peak; lock.unlock()
            } catch { lock.lock(); failure = error.localizedDescription; lock.unlock() }
        }
    }
    public var snapshot: (level: Float, error: String?) {
        lock.lock(); defer { lock.unlock() }; return (level, failure)
    }
    public func finish() -> AudioTrack? {
        queue.sync {
            file = nil
            return RecordingStore.inspect(url, offset: firstOffset ?? 0)
        }
    }
    public var track: AudioTrack? {
        queue.sync {
            guard let file else { return nil }
            return AudioTrack(file: url.lastPathComponent, startOffset: firstOffset ?? 0, duration: Double(framesWritten) / file.fileFormat.sampleRate, sampleRate: file.fileFormat.sampleRate, channels: file.fileFormat.channelCount)
        }
    }
}
