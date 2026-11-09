import Foundation

public protocol SpeechEngine: Sendable {
    func load(id: String, folder: URL) async throws
    func transcribe(_ samples: [Float]) async throws -> [SpeechSegment]
    func unload() async
}
extension LocalSpeechEngine: SpeechEngine {}
