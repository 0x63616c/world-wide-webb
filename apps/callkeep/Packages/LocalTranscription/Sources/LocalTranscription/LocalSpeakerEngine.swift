import Foundation
import CoreML
import FluidAudio

public struct SpeakerTurn: Codable, Sendable, Equatable {
    public let speakerID: String
    public let start: Double
    public let end: Double
}

public struct SpeakerAnalysis: Codable, Sendable {
    public let turns: [SpeakerTurn]
    public let embeddings: [String: [Float]]
}

/// Runs only against an explicitly installed and verified model folder.
public enum LocalSpeakerEngine {
    public static func analyze(audio: URL, modelFolder: URL, offset: Double) async throws -> SpeakerAnalysis {
        func model(_ name: String, cpu: Bool = false) async throws -> MLModel {
            let config = MLModelConfiguration()
            if cpu { config.computeUnits = .cpuOnly }
            return try await MLModel.load(contentsOf: modelFolder.appendingPathComponent(name + ".mlmodelc"), configuration: config)
        }
        let data = try Data(contentsOf: modelFolder.appendingPathComponent("plda-parameters.json"))
        guard let root = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let tensors = root["tensors"] as? [String: Any], let psi = tensors["psi"] as? [String: Any],
              let encoded = psi["data_base64"] as? String, let bytes = Data(base64Encoded: encoded),
              !bytes.isEmpty, bytes.count.isMultiple(of: 4) else { throw CocoaError(.fileReadCorruptFile) }
        let values: [Double] = stride(from: 0, to: bytes.count, by: 4).map { index in
            let bits = UInt32(bytes[index]) | UInt32(bytes[index+1]) << 8 | UInt32(bytes[index+2]) << 16 | UInt32(bytes[index+3]) << 24
            return Double(Float(bitPattern: bits))
        }
        let models = try await OfflineDiarizerModels(segmentationModel: model("Segmentation"), fbankModel: model("FBank", cpu: true), embeddingModel: model("Embedding"), pldaRhoModel: model("PldaRho"), pldaPsi: values, compilationDuration: 0)
        let manager = OfflineDiarizerManager()
        manager.initialize(models: models)
        let result = try await manager.process(audio)
        return SpeakerAnalysis(turns: result.segments.map { SpeakerTurn(speakerID: $0.speakerId, start: Double($0.startTimeSeconds) + offset, end: Double($0.endTimeSeconds) + offset) }, embeddings: result.speakerDatabase ?? [:])
    }
}
