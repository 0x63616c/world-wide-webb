import ImageIO
import PhotosUI
import SwiftUI
import UniformTypeIdentifiers

struct PanelProfilePhoto: View {
    @AppStorage("panel.profilePhoto") private var photo = Data()
    @State private var selection: PhotosPickerItem?
    @State private var thumbnail: CGImage?

    var body: some View {
        PhotosPicker(selection: $selection, matching: .images) {
            Group {
                if let thumbnail {
                    Image(decorative: thumbnail, scale: 1).resizable().scaledToFill()
                } else {
                    Image(systemName: "person.crop.circle.fill")
                        .font(.system(size: 42))
                        .foregroundStyle(.white.opacity(0.85))
                }
            }
            .frame(width: 48, height: 48)
            .clipShape(.circle)
            .contentShape(.circle)
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Choose profile photo")
        .accessibilityIdentifier("home-profile")
        .task(id: photo) {
            #if DEBUG
            if let path = ProcessInfo.processInfo.environment["PANEL_PROFILE_PREVIEW"],
               let data = try? Data(contentsOf: URL(fileURLWithPath: path)) {
                thumbnail = Self.decodeThumbnail(data)
                return
            }
            #endif
            thumbnail = Self.decodeThumbnail(photo)
        }
        .task(id: selection) {
            guard let selection,
                  let data = try? await selection.loadTransferable(type: Data.self),
                  !Task.isCancelled,
                  let image = Self.decodeThumbnail(data) else { return }
            let output = NSMutableData()
            guard let destination = CGImageDestinationCreateWithData(output, UTType.jpeg.identifier as CFString, 1, nil) else { return }
            CGImageDestinationAddImage(destination, image, [kCGImageDestinationLossyCompressionQuality: 0.86] as CFDictionary)
            if CGImageDestinationFinalize(destination) { photo = output as Data }
        }
    }

    private static func decodeThumbnail(_ data: Data) -> CGImage? {
        guard !data.isEmpty, let source = CGImageSourceCreateWithData(data as CFData, nil) else { return nil }
        return CGImageSourceCreateThumbnailAtIndex(source, 0, [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceThumbnailMaxPixelSize: 640
        ] as CFDictionary)
    }
}
