import SwiftUI
import UIKit
import CoreImage

/// Panel-only composition: no changes to the prototype's fixture presentation.
/// This module includes booth captures, so its whole surface uses the booth's
/// private policy: a fresh synced PIN on every opening, including the frame.
struct LivePhotosModule: View {
    let provider: LivePhotosProvider
    let detail: Bool
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var pin = ""
    @State private var checking = false
    @State private var rejected = false
    @State private var selectedID: String?
    @State private var removal: LivePhoto?
    @State private var showSessions = false

    private var selected: LivePhoto? {
        provider.frames.first { $0.id == selectedID } ?? provider.frames.first
    }

    var body: some View {
        GlassEffectContainer(spacing: 16) {
            Group {
                if !provider.unlocked { gate }
                else if let photo = selected {
                    VStack(spacing: 16) {
                        if detail {
                            HStack {
                                Text("Photos").font(.title)
                                Spacer()
                                Button(showSessions ? "Photos" : "Activity sessions") { showSessions.toggle() }
                                    .buttonStyle(.glass)
                                Button("Lock") { provider.lock() }.buttonStyle(.glass)
                            }
                        }
                        if showSessions && detail { sessions }
                        else {
                            AuthenticatedPhoto(provider: provider, photo: photo)
                                .id(photo).frame(maxWidth: .infinity, maxHeight: .infinity)
                                .clipped().accessibilityLabel(photo.groupID == nil ? "Wake photo" : "Photo Booth capture")
                            HStack {
                                Button("Previous", systemImage: "chevron.left") { advance(-1) }
                                Spacer()
                                Text(Date(timeIntervalSince1970: photo.capturedAt / 1000), style: .date)
                                Spacer()
                                Button("Next", systemImage: "chevron.right") { advance(1) }
                            }.buttonStyle(.glass)
                            if detail, photo.groupID != nil {
                                HStack {
                                    if photo.filter != nil {
                                        Button("Clear filter") { Task { await provider.clearFilter(photo) } }
                                    }
                                    Button("Remove capture", role: .destructive) { removal = photo }
                                }.buttonStyle(.glass).disabled(provider.pending)
                            }
                            if let error = provider.error { Text(error).foregroundStyle(.secondary) }
                        }
                    }.padding(24)
                } else { ContentUnavailableView("No photos", systemImage: "photo") }
            }
        }
        #if DEBUG
        .task {
            // Screenshot harness still exercises settings.get and the real gate.
            // Fixture mode fixes the API transport to local bundled data.
            if ProcessInfo.processInfo.arguments.contains("-hybridFixtures"),
               let fixturePIN = UserDefaults.standard.string(forKey: "photosFixturePIN") {
                _ = await provider.unlock(pin: fixturePIN)
            }
        }
        #endif
        .onDisappear { provider.lock(); pin = "" }
        .onChange(of: scenePhase) { _, phase in
            if phase != .active { provider.lock(); pin = "" }
        }
        .confirmationDialog("Remove this whole capture from the gallery?", isPresented: Binding(
            get: { removal != nil }, set: { if !$0 { removal = nil } })) {
            if let photo = removal {
                Button("Remove capture", role: .destructive) {
                    removal = nil
                    Task { await provider.remove(photo) }
                }
            }
        }
        .task(id: provider.unlocked && !detail && !reduceMotion) {
            guard provider.unlocked, !detail, !reduceMotion else { return }
            while !Task.isCancelled {
                do { try await Task.sleep(for: .seconds(12)) } catch { return }
                advance(1)
            }
        }
    }

    private var gate: some View {
        VStack(spacing: 20) {
            Label("Photos", systemImage: "lock.fill").font(.title)
            Text("Enter your panel PIN")
            SecureField("6-digit PIN", text: $pin)
                .keyboardType(.numberPad).textContentType(.oneTimeCode)
                .textFieldStyle(.roundedBorder).frame(width: 260)
                .accessibilityIdentifier("photos-pin")
                .onChange(of: pin) { _, value in pin = String(value.filter(\.isNumber).prefix(6)) }
            Button("Unlock") {
                checking = true
                let entered = pin; pin = ""
                Task {
                    rejected = !(await provider.unlock(pin: entered))
                    checking = false
                }
            }.buttonStyle(.glassProminent).disabled(pin.count != 6 || checking)
            if rejected { Text("PIN not accepted. Try again.").foregroundStyle(.secondary) }
        }.frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var sessions: some View {
        List(provider.sessions) { session in
            VStack(alignment: .leading, spacing: 8) {
                Text(Date(timeIntervalSince1970: session.startedAt / 1000), style: .date)
                Text(session.deviceName)
                Text("\(session.eventCount) events · \(session.photoPaths.count) photos")
                if let digest = session.digest { Text(digest) }
            }
        }
    }

    private func advance(_ offset: Int) {
        let frames = provider.frames
        guard !frames.isEmpty else { selectedID = nil; return }
        let index = frames.firstIndex { $0.id == selected?.id } ?? 0
        selectedID = frames[(index + offset + frames.count) % frames.count].id
    }
}

private struct AuthenticatedPhoto: View {
    let provider: LivePhotosProvider
    let photo: LivePhoto
    @State private var image: UIImage?
    @State private var failed = false
    var body: some View {
        GeometryReader { proxy in
            Group {
                if let image {
                    Image(uiImage: image).resizable().scaledToFit()
                } else if failed {
                    ContentUnavailableView("Photo unavailable", systemImage: "photo.badge.exclamationmark")
                } else { ProgressView() }
            }.frame(width: proxy.size.width, height: proxy.size.height)
        }.task {
            do {
                let data = try await provider.image(photo)
                try Task.checkCancellation()
                guard let decoded = UIImage(data: data) else { failed = true; return }
                image = PhotoDisplayFilter.apply(photo.filter, to: decoded)
            } catch { if !Task.isCancelled { failed = true } }
        }
    }
}

/// The web stores raw pixels plus a CSS filter identifier. Apply its ordered
/// color operations at display time, leaving cached bytes untouched.
private enum PhotoDisplayFilter {
    static func apply(_ name: String?, to image: UIImage) -> UIImage {
        guard var source = CIImage(image: image) else { return image }
        func matrix(_ rows: [[Double]], offset: Double = 0) {
            let vector: ([Double]) -> CIVector = { CIVector(x: $0[0], y: $0[1], z: $0[2], w: 0) }
            source = source.applyingFilter("CIColorMatrix", parameters: [
                "inputRVector": vector(rows[0]), "inputGVector": vector(rows[1]),
                "inputBVector": vector(rows[2]), "inputAVector": CIVector(x: 0, y: 0, z: 0, w: 1),
                "inputBiasVector": CIVector(x: offset, y: offset, z: offset, w: 0)
            ])
        }
        func multiply(_ value: Double, offset: Double = 0) {
            matrix([[value, 0, 0], [0, value, 0], [0, 0, value]], offset: offset)
        }
        func contrast(_ value: Double) { multiply(value, offset: 0.5 * (1 - value)) }
        func saturate(_ value: Double) {
            let r = 0.213 * (1 - value), g = 0.715 * (1 - value), b = 0.072 * (1 - value)
            matrix([[r + value, g, b], [r, g + value, b], [r, g, b + value]])
        }
        func sepia(_ value: Double) {
            let t = 1 - value
            matrix([[t + 0.393 * value, 0.769 * value, 0.189 * value],
                    [0.349 * value, t + 0.686 * value, 0.168 * value],
                    [0.272 * value, 0.534 * value, t + 0.131 * value]])
        }
        func hue(_ degrees: Double) {
            source = source.applyingFilter("CIHueAdjust", parameters: ["inputAngle": degrees * .pi / 180])
        }
        switch name {
        case "mono": saturate(0); contrast(1.08)
        case "sepia": sepia(0.7); contrast(1.05); multiply(1.02)
        case "vivid": saturate(1.75); contrast(1.12)
        case "cool": hue(-16); saturate(1.2); multiply(1.04)
        case "warm": sepia(0.28); saturate(1.4); multiply(1.05); hue(-8)
        case "noir": saturate(0); contrast(1.45); multiply(0.92)
        default: return image
        }
        guard let output = CIContext().createCGImage(source, from: source.extent) else { return image }
        return UIImage(cgImage: output, scale: image.scale, orientation: image.imageOrientation)
    }
}
