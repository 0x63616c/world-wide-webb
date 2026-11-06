@preconcurrency import AVFoundation
import UIKit
import SwiftUI
import ImageIO
import UniformTypeIdentifiers

/// Camera configuration and capture stay off the main actor, on one serial actor.
actor PhotoBoothCaptureSession {
    /// Only device identity/rotation is read by the preview; configuration stays in this actor.
    struct PreviewDevice: @unchecked Sendable { let value: AVCaptureDevice }
    nonisolated let session = AVCaptureSession()
    private let output = AVCapturePhotoOutput()
    private var device: AVCaptureDevice?
    private var wantsRunning = false
    private var processor: BoothPhotoProcessor?
    private var pending: CheckedContinuation<Data, Error>?
    private var captureID: UInt64 = 0
    enum Failure: Error { case unavailable, configuration, capture }

    func start() throws -> PreviewDevice {
        wantsRunning = true
        if let device {
            if !session.isRunning { session.startRunning() }
            return PreviewDevice(value: device)
        }
        guard let camera = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .front)
            ?? AVCaptureDevice.default(for: .video) else { throw Failure.unavailable }
        let input = try AVCaptureDeviceInput(device: camera)
        session.beginConfiguration()
        defer { session.commitConfiguration() }
        session.sessionPreset = .photo
        guard session.canAddInput(input), session.canAddOutput(output) else { throw Failure.configuration }
        session.addInput(input)
        session.addOutput(output)
        output.maxPhotoQualityPrioritization = .balanced
        device = camera
        // startRunning must happen after the configuration transaction commits.
        return PreviewDevice(value: camera)
    }
    func run() { if wantsRunning && !session.isRunning { session.startRunning() } }
    func stop() {
        wantsRunning = false
        if pending == nil && session.isRunning { session.stopRunning() }
    }
    func capture(angle: CGFloat, quiet: Bool = false) async throws -> Data {
        guard pending == nil, session.isRunning else { throw Failure.capture }
        return try await withCheckedThrowingContinuation { continuation in
            pending = continuation
            captureID += 1
            let id = captureID
            let processor = BoothPhotoProcessor { result in Task { await self.complete(id: id, result) } }
            self.processor = processor // Retain the delegate through processing.
            if let connection = output.connection(with: .video) {
                if connection.isVideoRotationAngleSupported(angle) { connection.videoRotationAngle = angle }
                if connection.isVideoMirroringSupported {
                    connection.automaticallyAdjustsVideoMirroring = false
                    connection.isVideoMirrored = device?.position == .front
                }
            }
            let settings = AVCapturePhotoSettings(format: [AVVideoCodecKey: AVVideoCodecType.jpeg])
            settings.photoQualityPrioritization = .balanced
            settings.isShutterSoundSuppressionEnabled = quiet && output.isShutterSoundSuppressionSupported
            output.capturePhoto(with: settings, delegate: processor)
        }
    }
    private func complete(id: UInt64, _ result: Result<Data, Error>) {
        guard id == captureID, let continuation = pending else { return }
        pending = nil; processor = nil
        if !wantsRunning && session.isRunning { session.stopRunning() }
        continuation.resume(with: result)
    }
}

private final class BoothPhotoProcessor: NSObject, AVCapturePhotoCaptureDelegate, @unchecked Sendable {
    let complete: @Sendable (Result<Data, Error>) -> Void
    init(complete: @escaping @Sendable (Result<Data, Error>) -> Void) { self.complete = complete }
    func photoOutput(_ output: AVCapturePhotoOutput, didFinishProcessingPhoto photo: AVCapturePhoto, error: Error?) {
        if let error { complete(.failure(error)); return }
        guard let data = photo.fileDataRepresentation() else {
            complete(.failure(PhotoBoothCaptureSession.Failure.capture)); return
        }
        // Bound the image to the existing booth ingest's 4 MiB JPEG contract.
        guard let source = CGImageSourceCreateWithData(data as CFData, nil),
              let image = CGImageSourceCreateThumbnailAtIndex(source, 0, [
                kCGImageSourceCreateThumbnailFromImageAlways: true,
                kCGImageSourceCreateThumbnailWithTransform: true,
                kCGImageSourceThumbnailMaxPixelSize: 2048
              ] as CFDictionary) else { complete(.failure(PhotoBoothCaptureSession.Failure.capture)); return }
        let bytes = NSMutableData()
        guard let destination = CGImageDestinationCreateWithData(bytes, UTType.jpeg.identifier as CFString, 1, nil) else {
            complete(.failure(PhotoBoothCaptureSession.Failure.capture)); return
        }
        CGImageDestinationAddImage(destination, image, [kCGImageDestinationLossyCompressionQuality: 0.85] as CFDictionary)
        guard CGImageDestinationFinalize(destination) else {
            complete(.failure(PhotoBoothCaptureSession.Failure.capture)); return
        }
        complete(.success(bytes as Data))
    }
    func photoOutput(_ output: AVCapturePhotoOutput, didFinishCaptureFor resolvedSettings: AVCaptureResolvedPhotoSettings, error: Error?) {
        if let error { complete(.failure(error)) }
    }
}

struct PhotoBoothPreview: UIViewRepresentable {
    let capture: PhotoBoothCaptureSession
    let device: AVCaptureDevice
    let rotation: @MainActor @Sendable (CGFloat) -> Void
    func makeUIView(context: Context) -> Preview { Preview(session: capture.session, device: device, rotation: rotation) }
    func updateUIView(_ view: Preview, context: Context) {}
    final class Preview: UIView {
        override class var layerClass: AnyClass { AVCaptureVideoPreviewLayer.self }
        private var preview: AVCaptureVideoPreviewLayer { layer as! AVCaptureVideoPreviewLayer }
        private var coordinator: AVCaptureDevice.RotationCoordinator?
        private var observation: NSKeyValueObservation?
        private var captureObservation: NSKeyValueObservation?
        init(session: AVCaptureSession, device: AVCaptureDevice, rotation: @escaping @MainActor @Sendable (CGFloat) -> Void) {
            super.init(frame: .zero)
            preview.session = session
            preview.videoGravity = .resizeAspect
            let coordinator = AVCaptureDevice.RotationCoordinator(device: device, previewLayer: preview)
            self.coordinator = coordinator
            observation = coordinator.observe(\.videoRotationAngleForHorizonLevelPreview, options: [.initial, .new]) { [weak self] coordinator, _ in
                Task { @MainActor [weak self] in
                    guard let self else { return }
                    if let connection = preview.connection {
                        let angle = coordinator.videoRotationAngleForHorizonLevelPreview
                        if connection.isVideoRotationAngleSupported(angle) { connection.videoRotationAngle = angle }
                        if connection.isVideoMirroringSupported {
                            connection.automaticallyAdjustsVideoMirroring = false
                            connection.isVideoMirrored = device.position == .front
                        }
                    }
                    rotation(coordinator.videoRotationAngleForHorizonLevelCapture)
                }
            }
            captureObservation = coordinator.observe(\.videoRotationAngleForHorizonLevelCapture, options: [.new]) { coordinator, _ in
                let angle = coordinator.videoRotationAngleForHorizonLevelCapture
                Task { @MainActor in rotation(angle) }
            }
        }
        required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
    }
}
