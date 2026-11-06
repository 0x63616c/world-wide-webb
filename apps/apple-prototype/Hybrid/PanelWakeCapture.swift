@preconcurrency import AVFoundation
import OSLog
import PanelKit
import UIKit

/// The native kiosk records an attributed burst after a tap wakes the dimmed panel.
@MainActor final class PanelWakeCapture {
    private let camera = PhotoBoothCaptureSession()
    private var inFlight = false
    private let log = Logger(subsystem: "co.worldwidewebb.panel", category: "wake-capture")

    func capture(using client: PanelAPIClient) {
        guard !inFlight, UIDevice.current.userInterfaceIdiom == .pad,
              !ProcessInfo.processInfo.isiOSAppOnMac else { return }
        inFlight = true
        Task {
            defer { inFlight = false }
            let permission = AVCaptureDevice.authorizationStatus(for: .video)
            let allowed = if permission == .notDetermined {
                await AVCaptureDevice.requestAccess(for: .video)
            } else {
                permission == .authorized
            }
            guard allowed, UIApplication.shared.applicationState == .active else { return }
            let sessionID = UUID()
            var frames: [(index: Int, capturedAt: Date, jpeg: Data)] = []
            do {
                let device = try await camera.start()
                guard device.value.position == .front else { await camera.stop(); return }
                let rotation = AVCaptureDevice.RotationCoordinator(device: device.value, previewLayer: nil)
                await camera.run()
                for index in 0..<3 {
                    try await Task.sleep(for: .milliseconds(index == 0 ? 700 : 600))
                    guard UIApplication.shared.applicationState == .active else { break }
                    let capturedAt = Date()
                    let jpeg = try await camera.capture(angle: rotation.videoRotationAngleForHorizonLevelCapture, quiet: true)
                    frames.append((index, capturedAt, jpeg))
                }
            } catch {
                log.warning("Wake camera capture failed")
            }
            await camera.stop()
            for frame in frames {
                do {
                    try await client.uploadWakePhoto(jpeg: frame.jpeg, capturedAt: frame.capturedAt,
                        sessionID: sessionID, frame: frame.index)
                } catch {
                    log.warning("Wake photo upload failed")
                }
            }
        }
    }
}
