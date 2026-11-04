import SwiftUI
import AVFoundation
import Observation
import PanelKit

@MainActor @Observable final class PhotoBoothCameraModel {
    enum Status { case starting, ready, denied, unavailable, failed }
    enum Mode: String, CaseIterable { case photo = "Photo", strip = "Strip" }
    static let timerOptions = [0, 1, 3, 5, 10]
    var mode: Mode = .photo
    var timerSeconds = 3
    private(set) var capturing = false
    private(set) var shotNumber = 0
    private(set) var status: Status = .starting
    private(set) var device: AVCaptureDevice?
    private(set) var countdown = 0
    private(set) var saving = false
    private(set) var saved = false
    private(set) var requestingPermission = false
    private(set) var error: String?
    private(set) var preview: UIImage?
    var rotation: CGFloat = 0
    let capture = PhotoBoothCaptureSession()
    @ObservationIgnored private let api: PhotosAPI
    @ObservationIgnored private let photos: LivePhotosProvider
    @ObservationIgnored private var countdownTask: Task<Void, Never>?
    @ObservationIgnored private var saveTask: Task<Void, Never>?
    @ObservationIgnored private var unsaved: Data?
    @ObservationIgnored private var capturedAt = Date()
    @ObservationIgnored private var generation = 0
    @ObservationIgnored private let capturePhoto: (@MainActor () async throws -> Data)?
    @ObservationIgnored private let sleep: @Sendable (Duration) async throws -> Void
    @ObservationIgnored private var retainsPreview = false
    var hasUnsavedPhoto: Bool { unsaved != nil && !saving }
    var usesTestCamera: Bool { capturePhoto != nil }

    init(api: PhotosAPI, photos: LivePhotosProvider,
         capturePhoto: (@MainActor () async throws -> Data)? = nil,
         sleep: @escaping @Sendable (Duration) async throws -> Void = { try await Task.sleep(for: $0) }) {
        self.api = api; self.photos = photos; self.capturePhoto = capturePhoto; self.sleep = sleep
    }
    func activate(_ active: Bool) async {
        generation += 1
        let revision = generation
        if !active {
            cancelCapture()
            await capture.stop()
            return
        }
        // Only explicit injected test cameras bypass the hardware permission path.
        if capturePhoto != nil { status = .ready; return }
        guard AVCaptureDevice.default(for: .video) != nil else { status = .unavailable; return }
        status = .starting
        let permission = AVCaptureDevice.authorizationStatus(for: .video)
        var allowed = permission == .authorized
        if permission == .notDetermined {
            requestingPermission = true
            allowed = await AVCaptureDevice.requestAccess(for: .video)
            requestingPermission = false
        }
        guard revision == generation else { return }
        guard allowed else { status = .denied; return }
        do {
            let device = try await capture.start()
            await capture.run()
            guard revision == generation else { return }
            self.device = device.value
            status = .ready
        } catch { if revision == generation { status = .failed } }
    }
    func shutter() {
        if capturing {
            cancelCapture()
            return
        }
        guard status == .ready, !saving, unsaved == nil else { return }
        let selectedMode = mode
        let delay = Self.timerOptions.contains(timerSeconds) ? timerSeconds : 3
        error = nil; preview = nil; saved = false; capturing = true
        countdownTask = Task {
            defer { countdown = 0; shotNumber = 0; capturing = false; countdownTask = nil }
            do {
                var frames: [Data] = []
                let count = selectedMode == .strip ? 4 : 1
                for index in 0..<count {
                    shotNumber = index + 1
                    try await countDown(index == 0 ? delay : 3)
                    try Task.checkCancellation()
                    let data: Data
                    if let capturePhoto { data = try await capturePhoto() }
                    else { data = try await capture.capture(angle: rotation) }
                    try Task.checkCancellation()
                    frames.append(data)
                    if count == 4 { AccessibilityNotification.Announcement("Photo \(index + 1) of 4").post() }
                }
                let capturedFrames = frames
                let bytes = selectedMode == .strip
                    ? try await Task.detached(priority: .userInitiated) { try PhotoBoothStrip.render(capturedFrames) }.value
                    : frames[0]
                try Task.checkCancellation()
                // Once complete, the app owns the save even if the page disappears.
                saveCapturedPhoto(bytes, at: .now, keepPreview: selectedMode == .strip)
            } catch is CancellationError {
                // Cancelled countdowns/partial strips never upload unseen photos.
            } catch {
                self.error = "Couldn’t take the photo. Try again."
            }
        }
    }
    private func countDown(_ seconds: Int) async throws {
        for value in stride(from: seconds, through: 1, by: -1) {
            countdown = value
            AccessibilityNotification.Announcement(String(value)).post()
            try await sleep(.seconds(1))
        }
        countdown = 0
    }
    func cancelCapture() { countdownTask?.cancel() }
    /// A captured JPEG is retained by the app-owned model until saved or explicitly discarded.
    @discardableResult func saveCapturedPhoto(_ data: Data, at date: Date, keepPreview: Bool = false) -> Task<Void, Never> {
        retainsPreview = keepPreview
        capturedAt = date; unsaved = data; preview = UIImage(data: data); saving = true
        let task = Task { await upload() }
        saveTask = task
        return task
    }
    @discardableResult func retrySave() -> Task<Void, Never>? {
        guard unsaved != nil, !saving else { return nil }
        saving = true
        let task = Task { await upload() }
        saveTask = task
        return task
    }
    private func upload() async {
        guard let data = unsaved else { saving = false; return }
        error = nil
        do {
            try await api.savePhoto(jpeg: data, capturedAt: capturedAt)
            unsaved = nil; saved = true
            AccessibilityNotification.Announcement("Photo saved").post()
            await photos.refresh()
            try? await Task.sleep(for: .seconds(2))
            if !retainsPreview { preview = nil }
            saved = false
        } catch { self.error = "Couldn’t save the photo. Try again." }
        saving = false
    }
    func discard() { unsaved = nil; preview = nil; error = nil; saved = false }
}

