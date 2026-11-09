import Foundation
import CoreML
import FluidAudio
import WhisperKit
import ArgmaxCore

public struct SpeechSegment: Sendable {
    public let start: Double
    public let end: Double
    public let text: String
    public init(start: Double, end: Double, text: String) {
        self.start = start; self.end = end; self.text = text
    }
}

// The only networking in Callkeep transcription is the app's explicit model
// downloader. Neither adapter can fall back to a remote model or tokenizer.
private final class OfflineWhisper: WhisperKit {
    override func loadTokenizerIfNeeded() async throws {
        guard tokenizer == nil, let tokenizerFolder else { return }
        guard let logits = textDecoder.logitsSize else { throw WhisperError.tokenizerUnavailable() }
        textDecoder.isModelMultilingual = logits > 51864
        let local = try await AutoTokenizerWrapper.from(modelFolder: tokenizerFolder)
        tokenizer = try OfflineTokenizer(local)
    }
}

// WhisperKit 1.1.1 makes its wrapper initializer internal. This small adapter
// uses the public tokenizer protocol and reads all special IDs from the pinned
// tokenizer, so missing/incompatible assets fail locally instead of downloading.
private struct OfflineTokenizer: WhisperTokenizer {
    let tokenizer: TokenizerWrapper
    let specialTokens: SpecialTokens
    let allLanguageTokens: Set<Int>
    init(_ tokenizer: TokenizerWrapper) throws {
        self.tokenizer = tokenizer
        func token(_ text: String) throws -> Int {
            guard let id = tokenizer.convertTokenToId(text) else { throw WhisperError.tokenizerUnavailable() }
            return id
        }
        specialTokens = try SpecialTokens(
            endToken: token("<|endoftext|>"), englishToken: token("<|en|>"),
            noSpeechToken: token("<|nospeech|>"), noTimestampsToken: token("<|notimestamps|>"),
            specialTokenBegin: token("<|endoftext|>"), startOfPreviousToken: token("<|startofprev|>"),
            startOfTranscriptToken: token("<|startoftranscript|>"), timeTokenBegin: token("<|0.00|>"),
            transcribeToken: token("<|transcribe|>"), translateToken: token("<|translate|>"), whitespaceToken: token(" "))
        let english = specialTokens.englishToken
        allLanguageTokens = Set((english..<specialTokens.translateToken).filter { id in
            guard let text = tokenizer.convertIdToToken(id), text.hasPrefix("<|"), text.hasSuffix("|>") else { return false }
            let code = text.dropFirst(2).dropLast(2)
            return (2...3).contains(code.count) && code.allSatisfy { $0.isLetter }
        })
    }
    func encode(text: String) -> [Int] { tokenizer.encode(text: text) }
    func decode(tokens: [Int]) -> String { tokenizer.decode(tokens: tokens) }
    func convertTokenToId(_ token: String) -> Int? { tokenizer.convertTokenToId(token) }
    func convertIdToToken(_ id: Int) -> String? { tokenizer.convertIdToToken(id) }
    func splitToWordTokens(tokenIds: [Int]) -> (words: [String], wordTokens: [[Int]]) {
        var words: [String] = [], groups: [[Int]] = [], pending: [Int] = []
        for id in tokenIds {
            pending.append(id)
            let text = tokenizer.decode(tokens: pending)
            guard !text.contains("\u{fffd}") else { continue }
            let punctuation = text.trimmingCharacters(in: .whitespaces).unicodeScalars.allSatisfy { CharacterSet.punctuationCharacters.contains($0) }
            if words.isEmpty || id >= specialTokens.specialTokenBegin || text.hasPrefix(" ") || punctuation {
                words.append(text); groups.append(pending)
            } else {
                words[words.count - 1] += text; groups[groups.count - 1] += pending
            }
            pending = []
        }
        if !pending.isEmpty { words.append(tokenizer.decode(tokens: pending)); groups.append(pending) }
        return (words, groups)
    }
}

public actor LocalSpeechEngine {
    private var parakeet: AsrManager?
    private var whisper: WhisperKit?
    private var loadedID: String?
    public init() {}
    public func unload() async {
        if let parakeet { await parakeet.cleanup() }
        if let whisper { await whisper.unloadModels() }
        parakeet = nil; whisper = nil; loadedID = nil
    }
    public func load(id: String, folder: URL) async throws {
        guard loadedID != id else { return }
        await unload()
        try Task.checkCancellation()
        if id == "parakeet-ultra" {
            func model(_ name: String, cpu: Bool = false) async throws -> MLModel {
                let config = MLModelConfiguration()
                config.computeUnits = cpu ? .cpuOnly : .cpuAndNeuralEngine
                return try await MLModel.load(contentsOf: folder.appendingPathComponent(name + ".mlmodelc"), configuration: config)
            }
            let data = try Data(contentsOf: folder.appendingPathComponent("parakeet_vocab.json"))
            let raw = try JSONDecoder().decode([String: String].self, from: data)
            let vocab = Dictionary(uniqueKeysWithValues: raw.compactMap { key, value in Int(key).map { ($0, value) } })
            let config = AsrModels.defaultConfiguration()
            let models = try await AsrModels(
                encoder: model("Encoder"), preprocessor: model("Preprocessor", cpu: true),
                decoder: model("Decoder"), joint: model("JointDecisionv3"),
                configuration: config, vocabulary: vocab, version: .ultra)
            let manager = AsrManager()
            try await manager.loadModels(models)
            parakeet = manager
        } else if id == "whisper-turbo" {
            whisper = try await OfflineWhisper(WhisperKitConfig(
                modelFolder: folder.path, tokenizerFolder: folder.appendingPathComponent("Tokenizer"),
                verbose: false, prewarm: false, load: true, download: false))
        } else {
            throw NSError(domain: "Callkeep", code: 1, userInfo: [NSLocalizedDescriptionKey: "Unsupported transcription model."])
        }
        try Task.checkCancellation()
        loadedID = id
    }
    public func transcribe(_ samples: [Float]) async throws -> [SpeechSegment] {
        try Task.checkCancellation()
        if let parakeet {
            var state = try TdtDecoderState()
            let result = try await parakeet.transcribe(samples, decoderState: &state)
            let words = buildWordTimings(from: result.tokenTimings ?? [])
            if words.isEmpty {
                return result.text.isEmpty ? [] : [SpeechSegment(start: 0, end: Double(samples.count) / 16000, text: result.text)]
            }
            // Group short phrases, keeping word timing for seeking and track offsets.
            var segments: [SpeechSegment] = []
            var group: [SpeechSegment] = []
            for timing in words {
                let word = SpeechSegment(start: timing.startTime, end: timing.endTime, text: timing.word)
                if let first = group.first, let last = group.last,
                   word.start - last.end > 0.7 || word.end - first.start > 8 {
                    segments.append(SpeechSegment(start: first.start, end: last.end, text: group.map(\.text).joined(separator: " ")))
                    group = []
                }
                group.append(word)
            }
            if let first = group.first, let last = group.last {
                segments.append(SpeechSegment(start: first.start, end: last.end, text: group.map(\.text).joined(separator: " ")))
            }
            return segments
        }
        guard let whisper else { throw NSError(domain: "Callkeep", code: 2, userInfo: [NSLocalizedDescriptionKey: "The transcription model is not loaded."]) }
        let results = try await whisper.transcribe(audioArray: samples, decodeOptions: DecodingOptions(
            language: "en", temperatureFallbackCount: 2, skipSpecialTokens: true, suppressBlank: true,
            concurrentWorkerCount: 1))
        return results.flatMap(\.segments).compactMap {
            let text = $0.text.trimmingCharacters(in: .whitespacesAndNewlines)
            return text.isEmpty ? nil : SpeechSegment(start: Double($0.start), end: Double($0.end), text: text)
        }
    }
}
