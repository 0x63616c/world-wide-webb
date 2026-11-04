import SwiftUI
import AVFoundation
import Observation
import PanelKit

@MainActor @Observable final class PhotoBoothCameraModel {
    enum Status { case starting, ready, denied, unavailable, failed }
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
    var hasUnsavedPhoto: Bool { unsaved != nil && !saving }

    init(api: PhotosAPI, photos: LivePhotosProvider) { self.api = api; self.photos = photos }
    func activate(_ active: Bool) async {
        generation += 1
        let revision = generation
        if !active {
            countdownTask?.cancel(); countdownTask = nil; countdown = 0
            await capture.stop()
            return
        }
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
        if countdown > 0 {
            countdownTask?.cancel(); countdownTask = nil; countdown = 0
            return
        }
        guard status == .ready, !saving, unsaved == nil else { return }
        error = nil; preview = nil; saved = false
        countdownTask = Task {
            do {
                for value in stride(from: 3, through: 1, by: -1) {
                    countdown = value
                    AccessibilityNotification.Announcement(String(value)).post()
                    try await Task.sleep(for: .seconds(1))
                }
                try Task.checkCancellation()
                countdown = 0; countdownTask = nil
                captureAndSave()
            } catch { countdown = 0 }
        }
    }
    private func captureAndSave() {
        saving = true
        // Owned by the model, so navigation cannot abandon an acknowledged upload.
        saveTask = Task {
            do {
                let data = try await capture.capture(angle: rotation)
                await saveCapturedPhoto(data, at: .now).value
            } catch {
                saving = false
                self.error = "Couldn’t take the photo. Try again."
            }
        }
    }
    /// A captured JPEG is retained by the app-owned model until saved or explicitly discarded.
    @discardableResult func saveCapturedPhoto(_ data: Data, at date: Date) -> Task<Void, Never> {
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
            preview = nil; saved = false
        } catch { self.error = "Couldn’t save the photo. Try again." }
        saving = false
    }
    func discard() { unsaved = nil; preview = nil; error = nil; saved = false }
}

/// The existing booth manifest is private: a fresh PIN protects each opening.
struct LivePhotoBoothModule: View {
    let photos: LivePhotosProvider
    let close: () -> Void
    let camera: PhotoBoothCameraModel
    @State private var authorized = false
    @State private var gallery = false
    @State private var selected: LivePhoto?
    @State private var confirmDiscard = false
    @State private var authorizationNotice: String?
    @Environment(\.scenePhase) private var scenePhase

    init(camera: PhotoBoothCameraModel, photos: LivePhotosProvider, close: @escaping () -> Void) {
        self.camera = camera; self.photos = photos; self.close = close
    }

    private var boothPhotos: [LivePhoto] {
        photos.frames.filter { $0.groupID != nil && $0.collection == "booth-photos" }
    }
    var body: some View {
        VStack(spacing: 0) {
            PanelAppNavigationBar(back: back)
            Group {
                if !authorized {
                    PanelPINEntry(title: "Photo Booth", notice: authorizationNotice) { pin in
                        let accepted = await photos.unlock(pin: pin)
                        authorized = accepted
                        if accepted { authorizationNotice = nil }
                        return accepted ? nil : photos.error ?? "PIN not accepted. Try again."
                    }
                } else if let selected { detail(selected) }
                else if gallery { galleryPage }
                else { cameraPage }
            }.frame(maxWidth: .infinity, maxHeight: .infinity)
        }.background(.black).foregroundStyle(.white)
            .accessibilityElement(children: .contain).accessibilityIdentifier("photo-booth-page")
            .task(id: "\(authorized)-\(gallery)-\(scenePhase == .active)") {
                await camera.activate(authorized && !gallery && scenePhase == .active)
            }
            .task(id: authorized) { if authorized { await photos.refresh() } }
            .onDisappear { lock(); Task { [camera] in await camera.activate(false) } }
            .onChange(of: scenePhase) { _, phase in
                if phase == .background || (phase == .inactive && !camera.requestingPermission) { lock() }
            }
            .onChange(of: photos.unlocked) { _, unlocked in
                if !unlocked && authorized {
                    authorized = false; gallery = false; selected = nil
                    authorizationNotice = "Photos couldn’t be loaded. Unlock to try again."
                }
            }
            .confirmationDialog("Discard the unsaved photo?", isPresented: $confirmDiscard) {
                Button("Discard", role: .destructive) { camera.discard(); close() }
            }
    }
    private func lock() { authorized = false; gallery = false; selected = nil; photos.lock() }
    private func back() {
        guard authorized else { close(); return } // A locked page cannot discard someone else's pending photo.
        if selected != nil { selected = nil }
        else if gallery { gallery = false }
        else if camera.hasUnsavedPhoto { confirmDiscard = true }
        else { close() }
    }
    private var cameraPage: some View {
        VStack(spacing: 24) {
            ZStack {
                if let image = camera.preview { Image(uiImage: image).resizable().scaledToFit() }
                else if camera.status == .ready, let device = camera.device {
                    PhotoBoothPreview(capture: camera.capture, device: device) { camera.rotation = $0 }
                } else {
                    switch camera.status {
                    case .starting: ProgressView()
                    case .denied:
                        ContentUnavailableView {
                            Label("Camera access is off", systemImage: "camera")
                        } actions: {
                            Button("Open Settings") {
                                if let url = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(url) }
                            }.buttonStyle(.glass)
                        }
                    case .unavailable: ContentUnavailableView("Camera unavailable", systemImage: "camera",
                        description: Text("This device has no camera."))
                    default:
                        ContentUnavailableView {
                            Label("Camera unavailable", systemImage: "camera")
                        } actions: { Button("Try again") { Task { await camera.activate(true) } }.buttonStyle(.glass) }
                    }
                }
                if camera.countdown > 0 {
                    Text(String(camera.countdown)).font(.system(size: 120, weight: .semibold, design: .rounded))
                        .shadow(color: .black.opacity(0.6), radius: 10)
                }
                if camera.saved {
                    Label("Saved", systemImage: "checkmark.circle.fill").font(.title2.weight(.semibold))
                        .padding(20).glassEffect(.regular, in: .capsule)
                } else if camera.saving { ProgressView().controlSize(.large) }
            }.frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(Color.white.opacity(0.04)).clipShape(.rect(cornerRadius: 32))
            if let error = camera.error {
                HStack(spacing: 20) {
                    Text(error).foregroundStyle(.secondary)
                    if camera.hasUnsavedPhoto {
                        Button("Retry save") { camera.retrySave() }.buttonStyle(.glass)
                        Button("Retake", action: camera.discard).buttonStyle(.glass)
                    }
                }.accessibilityIdentifier("booth-error")
            }
            HStack {
                Button { gallery = true } label: {
                    Label("Booth photos", systemImage: "photo.stack").labelStyle(.iconOnly)
                        .font(.system(size: 26)).frame(width: 64, height: 64)
                }.buttonStyle(.glass).buttonBorderShape(.circle).accessibilityIdentifier("booth-gallery")
                Spacer()
                Button(action: camera.shutter) {
                    ZStack {
                        Circle().strokeBorder(.white, lineWidth: 4).frame(width: 88, height: 88)
                        if camera.countdown > 0 { Image(systemName: "xmark").font(.title) }
                        else { Circle().fill(.white).frame(width: 72, height: 72) }
                    }
                }.buttonStyle(.plain).disabled(camera.status != .ready || camera.saving || camera.hasUnsavedPhoto)
                    .opacity(camera.status == .ready ? 1 : 0.3)
                    .accessibilityLabel(camera.countdown > 0 ? "Cancel countdown" : "Take photo")
                    .accessibilityHint("Takes a photo after three seconds")
                    .accessibilityIdentifier("booth-shutter")
                Spacer()
                Color.clear.frame(width: 88, height: 64).accessibilityHidden(true)
            }.frame(height: 96)
        }.padding(.horizontal, 48).padding(.bottom, 32)
            .accessibilityElement(children: .contain).accessibilityIdentifier("booth-camera")
    }
    private var galleryPage: some View {
        VStack(alignment: .leading, spacing: 24) {
            Text("Booth photos").font(.largeTitle.weight(.semibold))
            if boothPhotos.isEmpty {
                ContentUnavailableView("No booth photos yet", systemImage: "photo.stack")
            } else {
                ScrollView {
                    LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 24), count: 3), spacing: 24) {
                        ForEach(boothPhotos) { photo in
                            Button { selected = photo } label: {
                                AuthenticatedPhoto(provider: photos, photo: photo).aspectRatio(4 / 3, contentMode: .fit)
                                    .clipShape(.rect(cornerRadius: 20))
                            }.buttonStyle(.plain).accessibilityLabel("Open booth photo")
                                .accessibilityIdentifier("booth-photo-\(photo.id)")
                        }
                    }
                }
            }
            if case .unavailable = photos.availability {
                Button("Couldn’t load photos. Try again") { Task { await photos.refresh() } }.buttonStyle(.glass)
            }
        }.padding(48).frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .accessibilityElement(children: .contain).accessibilityIdentifier("booth-photos")
    }
    private func detail(_ photo: LivePhoto) -> some View {
        AuthenticatedPhoto(provider: photos, photo: photo)
            .padding(32).accessibilityLabel("Booth photo").accessibilityIdentifier("booth-photo-detail")
    }
}
