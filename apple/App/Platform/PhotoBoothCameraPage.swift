import SwiftUI

struct PhotoBoothCameraPage: View {
    let camera: PhotoBoothCameraModel
    let provider: LivePhotosProvider
    let latest: LivePhoto?
    let close: () -> Void
    let openGallery: () -> Void

    @Environment(\.horizontalSizeClass) private var sizeClass
    private var inset: CGFloat { sizeClass == .compact ? 20 : 32 }
    private var busy: Bool { camera.capturing || camera.saving || camera.hasUnsavedPhoto }

    var body: some View {
        ZStack {
            GeometryReader { geometry in
                preview
                    .frame(width: geometry.size.width, height: geometry.size.height)
                    .clipped()
            }.ignoresSafeArea()

            VStack {
                LinearGradient(colors: [.black.opacity(0.48), .clear], startPoint: .top, endPoint: .bottom)
                    .frame(height: 120)
                Spacer()
                LinearGradient(colors: [.clear, .black.opacity(0.76)], startPoint: .top, endPoint: .bottom)
                    .frame(height: sizeClass == .compact ? 205 : 235)
            }.ignoresSafeArea().allowsHitTesting(false).accessibilityHidden(true)

            if camera.countdown > 0 {
                Text(camera.countdown, format: .number)
                    .font(.system(size: sizeClass == .compact ? 96 : 128, weight: .semibold, design: .rounded))
                    .monospacedDigit()
                    .shadow(color: .black.opacity(0.75), radius: 14)
                    .accessibilityIdentifier("booth-countdown")
            }

            VStack {
                HStack {
                    timer
                    Spacer()
                    PanelAppBackButton(back: close)
                        .accessibilityLabel("Close Photo Booth")
                }
                Spacer()
                feedback
                captureDock
            }.padding(.horizontal, inset).padding(.top, 14).padding(.bottom, 16)
        }
        .accessibilityElement(children: .contain).accessibilityIdentifier("booth-camera")
    }

    @ViewBuilder private var preview: some View {
        if let image = camera.preview, !camera.hasSavedStrip {
            Image(uiImage: image).resizable().scaledToFit()
                .accessibilityIdentifier("booth-capture-preview")
        } else if let image = camera.testPreview {
            Image(uiImage: image).resizable().scaledToFill().accessibilityHidden(true)
        } else if camera.usesTestCamera {
            ContentUnavailableView("Simulator camera", systemImage: "camera", description: Text("Test images only"))
        } else if camera.status == .ready, let device = camera.device {
            PhotoBoothPreview(capture: camera.capture, device: device) { camera.rotation = $0 }
                .accessibilityHidden(true)
        } else {
            switch camera.status {
            case .starting: ProgressView()
            case .denied:
                ContentUnavailableView {
                    Label("Camera access is off", systemImage: "camera")
                } description: {
                    Text("Allow camera access in Settings to take a photo.")
                } actions: {
                    Button("Open Settings") {
                        if let url = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(url) }
                    }.buttonStyle(.glass)
                }
            case .unavailable: ContentUnavailableView("Camera unavailable", systemImage: "camera")
            default:
                ContentUnavailableView {
                    Label("Camera unavailable", systemImage: "camera")
                } actions: {
                    Button("Try again") { Task { await camera.activate(true) } }.buttonStyle(.glass)
                }
            }
        }
    }

    private var timer: some View {
        Menu {
            Picker("Self-timer", selection: Binding(get: { camera.timerSeconds }, set: { camera.timerSeconds = $0 })) {
                ForEach(PhotoBoothCameraModel.timerOptions, id: \.self) { seconds in
                    Text(seconds == 0 ? "Off" : "\(seconds) \(seconds == 1 ? "second" : "seconds")").tag(seconds)
                }
            }
        } label: {
            Label(camera.timerSeconds == 0 ? "Off" : "\(camera.timerSeconds)s", systemImage: "timer")
                .font(.headline).padding(.horizontal, 12).frame(minHeight: 48)
        }
        .buttonStyle(.glass).buttonBorderShape(.capsule).disabled(busy)
        .accessibilityLabel("Self-timer, \(camera.timerSeconds == 0 ? "off" : "\(camera.timerSeconds) \(camera.timerSeconds == 1 ? "second" : "seconds")")")
        .accessibilityIdentifier("booth-timer")
    }

    @ViewBuilder private var feedback: some View {
        if let error = camera.error {
            VStack(spacing: 10) {
                Text(error).font(.callout.weight(.medium)).multilineTextAlignment(.center)
                if camera.hasUnsavedPhoto {
                    HStack {
                        Button {
                            camera.retrySave()
                        } label: {
                            Text("Retry save").foregroundStyle(.black)
                        }.buttonStyle(.glassProminent).tint(.white)
                        Button("Retake", action: camera.discard).buttonStyle(.glass)
                    }
                }
            }
            .padding(12).background(.black.opacity(0.8), in: .rect(cornerRadius: 16))
            .accessibilityIdentifier("booth-error")
        } else if camera.saved {
            Label("Saved", systemImage: "checkmark").font(.headline)
                .padding(12).glassEffect(.regular, in: .capsule)
        } else if camera.saving {
            ProgressView().controlSize(.large).accessibilityLabel("Saving")
        }
    }

    private var captureDock: some View {
        VStack(spacing: 12) {
            shutter
                .frame(maxWidth: .infinity)
                .overlay(alignment: .leading) { galleryButton }
                .overlay(alignment: .trailing) {
                    if camera.capturing && camera.mode == .strip {
                        Text("\(camera.shotNumber) of 4").font(.subheadline.monospacedDigit().weight(.semibold))
                            .padding(.horizontal, 12).padding(.vertical, 8)
                            .glassEffect(.regular, in: .capsule)
                            .accessibilityLabel("Photo \(camera.shotNumber) of 4")
                            .accessibilityIdentifier("booth-shot-progress")
                    }
                }
            BoothModeSwitcher(selection: Binding(get: { camera.mode }, set: { camera.mode = $0 }))
                .disabled(busy)
        }
    }

    private var shutter: some View {
        let size: CGFloat = sizeClass == .compact ? 72 : 88
        return Button(action: camera.shutter) {
            ZStack {
                Circle().strokeBorder(.white, lineWidth: 3)
                if camera.capturing {
                    RoundedRectangle(cornerRadius: 7).fill(.white).frame(width: size * 0.4, height: size * 0.4)
                } else {
                    Circle().fill(.white).padding(8)
                }
            }.frame(width: size, height: size)
        }
        .buttonStyle(.plain).contentShape(.circle)
        .disabled(camera.status != .ready || camera.saving || camera.hasUnsavedPhoto)
        .opacity(camera.status == .ready ? 1 : 0.35)
        .accessibilityLabel(camera.capturing ? "Cancel capture" : camera.mode == .strip ? "Take photo strip" : "Take photo")
        .accessibilityIdentifier("booth-shutter")
    }

    private var galleryButton: some View {
        Button(action: openGallery) {
            Group {
                if let latest {
                    AuthenticatedPhoto(provider: provider, photo: latest, mode: .fill, thumbnailSize: 64)
                } else {
                    Image(systemName: "photo.on.rectangle").font(.title2)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            }
            .frame(width: 58, height: 58)
            .background(.black.opacity(0.7))
            .clipShape(.rect(cornerRadius: 13))
            .overlay { RoundedRectangle(cornerRadius: 13).strokeBorder(.white.opacity(0.6)) }
        }
        .buttonStyle(.plain).disabled(busy)
        .accessibilityLabel("Booth photos").accessibilityIdentifier("booth-gallery")
    }
}

private struct BoothModeSwitcher: View {
    @Binding var selection: PhotoBoothCameraModel.Mode
    @Namespace private var highlight
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.isEnabled) private var isEnabled

    var body: some View {
        HStack(spacing: 0) {
            ForEach(PhotoBoothCameraModel.Mode.allCases, id: \.self) { mode in
                Button {
                    select(mode)
                } label: {
                    Text(mode.rawValue)
                        .font(.headline)
                        .foregroundStyle(selection == mode ? Color.yellow : .white)
                        .frame(width: 86, height: 44)
                        .background {
                            if selection == mode {
                                Capsule().fill(.white.opacity(0.22))
                                    .matchedGeometryEffect(id: "capture-mode", in: highlight)
                            }
                        }
                        .contentShape(.capsule)
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(selection == mode ? .isSelected : [])
            }
        }
        .padding(4)
        .glassEffect(.regular.interactive(), in: .capsule)
        .simultaneousGesture(DragGesture(minimumDistance: 18).onEnded { drag in
            guard isEnabled, abs(drag.translation.width) > abs(drag.translation.height) else { return }
            select(drag.translation.width < 0 ? .strip : .photo)
        })
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Capture mode")
        .accessibilityIdentifier("booth-mode")
    }

    private func select(_ mode: PhotoBoothCameraModel.Mode) {
        withAnimation(reduceMotion ? nil : .smooth(duration: 0.25)) { selection = mode }
    }
}
