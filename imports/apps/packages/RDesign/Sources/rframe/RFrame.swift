// rframe: renders App Store marketing frames from raw simulator captures for any -r app.
// The palette and type match RDesign: the icon's ink and paper, the graphite accent, SF Pro
// headlines and the tracked uppercase eyebrow. Black, white and graphite only.
//
//   swift run --package-path packages/RDesign -c release rframe \
//     apps/tendr/screenshots.json build/screenshots/raw apps/tendr/fastlane/screenshots/en-US build/screenshots/overview.png
#if os(macOS)
import AppKit
import RDesign
import SwiftUI
import UniformTypeIdentifiers

let canvas = CGSize(width: 1320, height: 2868)

enum Palette {
    static let ink = Color(white: 0.055)
    static let paper = Color(white: 0.95)
    static let mist = Color(red: 0.96, green: 0.96, blue: 0.96) // Theme.background (light)
    static let graphiteDark = Color(white: 0.72)                 // Graphite accent, dark
    static let graphiteLight = Color(white: 0.28)                // Graphite accent, light
}

struct Backdrop: View {
    let dark: Bool
    var body: some View { dark ? Palette.ink : Palette.mist }
}

/// A modern iPhone with a titanium rim, black bezel and Dynamic Island, sized by its screen width.
struct Device: View {
    let screen: NSImage
    let width: CGFloat
    let dark: Bool
    var body: some View {
        let height = width * screen.size.height / screen.size.width
        let bezel = width * 0.03
        let rim = width * 0.008
        let screenRadius = width * 0.141
        let outer = CGSize(width: width + bezel * 2, height: height + bezel * 2)
        ZStack {
            RoundedRectangle(cornerRadius: screenRadius + bezel, style: .continuous)
                .fill(LinearGradient(colors: [Color(white: 0.42), Color(white: 0.17), Color(white: 0.30), Color(white: 0.14)], startPoint: .topLeading, endPoint: .bottomTrailing))
            RoundedRectangle(cornerRadius: screenRadius + bezel - rim, style: .continuous)
                .fill(Color.black)
                .padding(rim)
            Image(nsImage: screen).resizable().interpolation(.high)
                .frame(width: width, height: height)
                .clipShape(RoundedRectangle(cornerRadius: screenRadius, style: .continuous))
            Capsule().fill(Color.black)
                .frame(width: width * 0.286, height: width * 0.084)
                .position(x: outer.width / 2, y: bezel + width * 0.026 + width * 0.042)
        }
        .frame(width: outer.width, height: outer.height)
        .background(alignment: .topLeading) { buttons(outer: outer, rim: rim) }
        .shadow(color: .black.opacity(dark ? 0.55 : 0.2), radius: 70, y: 40)
    }

    private func buttons(outer: CGSize, rim: CGFloat) -> some View {
        let fill = LinearGradient(colors: [Color(white: 0.36), Color(white: 0.16)], startPoint: .leading, endPoint: .trailing)
        let depth = rim * 0.9
        func key(_ x: CGFloat, _ top: CGFloat, _ length: CGFloat) -> some View {
            RoundedRectangle(cornerRadius: depth).fill(fill)
                .frame(width: depth * 2, height: outer.height * length)
                .offset(x: x, y: outer.height * top)
        }
        return ZStack(alignment: .topLeading) {
            key(-depth, 0.165, 0.035)
            key(-depth, 0.225, 0.062)
            key(-depth, 0.302, 0.062)
            key(outer.width - depth, 0.255, 0.095)
            key(outer.width - depth, 0.505, 0.055)
        }
    }
}

struct Frame: View {
    let shot: RFrameShot
    let screen: NSImage
    var dark: Bool { shot.appearance == "dark" }
    var body: some View {
        ZStack(alignment: .top) {
            Backdrop(dark: dark)
            VStack(spacing: 0) {
                Text(shot.eyebrow.uppercased())
                    .font(.system(size: 32, weight: .bold))
                    .tracking(5.1)
                    .foregroundStyle(dark ? Palette.graphiteDark : Palette.graphiteLight)
                Text(shot.headline)
                    .font(.system(size: 112, weight: .bold))
                    .tracking(-1.6)
                    .lineSpacing(2)
                    .foregroundStyle(dark ? Palette.paper : Palette.ink)
                    .padding(.top, 30)
                Device(screen: screen, width: 1100, dark: dark)
                    .padding(.top, 120)
            }
            .multilineTextAlignment(.center)
            .fixedSize(horizontal: false, vertical: true)
            .padding(.top, 196)
            .frame(width: canvas.width, height: canvas.height, alignment: .top)
        }
        .frame(width: canvas.width, height: canvas.height)
        .clipped()
    }
}

struct Overview: View {
    let frames: [NSImage]
    var body: some View {
        HStack(spacing: 48) {
            ForEach(frames.indices, id: \.self) { index in
                Image(nsImage: frames[index]).resizable().interpolation(.high)
                    .frame(width: 440, height: 956)
                    .clipShape(RoundedRectangle(cornerRadius: 28, style: .continuous))
            }
        }
        .padding(80)
        .background(Color(white: 0.16))
    }
}

/// Writes an opaque sRGB PNG: App Store Connect rejects screenshots with an alpha channel.
@MainActor func render(_ view: some View, size: CGSize, to url: URL) throws {
    let renderer = ImageRenderer(content: view.frame(width: size.width, height: size.height))
    renderer.scale = 1
    renderer.proposedSize = ProposedViewSize(size)
    guard let image = renderer.cgImage,
          let context = CGContext(data: nil, width: Int(size.width), height: Int(size.height), bitsPerComponent: 8, bytesPerRow: 0,
                                  space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)
    else { throw CocoaError(.fileWriteUnknown) }
    context.draw(image, in: CGRect(origin: .zero, size: size))
    guard let opaque = context.makeImage(),
          let destination = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil)
    else { throw CocoaError(.fileWriteUnknown) }
    CGImageDestinationAddImage(destination, opaque, nil)
    guard CGImageDestinationFinalize(destination) else { throw CocoaError(.fileWriteUnknown) }
}

@main struct RFrame {
    @MainActor static func main() throws {
        let arguments = Array(CommandLine.arguments.dropFirst())
        guard arguments.count >= 3 else {
            FileHandle.standardError.write(Data("usage: rframe <screenshots.json> <raw-dir> <output-dir> [overview.png]\n".utf8))
            exit(64)
        }
        let shots = try JSONDecoder().decode(RFrameConfig.self, from: Data(contentsOf: URL(fileURLWithPath: arguments[0]))).shots
        let raw = URL(fileURLWithPath: arguments[1])
        let output = URL(fileURLWithPath: arguments[2])
        let overview = arguments.count > 3 ? URL(fileURLWithPath: arguments[3]) : nil
        let files = FileManager.default
        try files.createDirectory(at: output, withIntermediateDirectories: true)
        for stale in try files.contentsOfDirectory(at: output, includingPropertiesForKeys: nil) where stale.pathExtension == "png" {
            try files.removeItem(at: stale)
        }
        var framed: [NSImage] = []
        for (index, shot) in shots.enumerated() {
            let source = raw.appendingPathComponent(shot.appearance).appendingPathComponent("\(shot.screen).png")
            guard let screen = NSImage(contentsOf: source) else { throw CocoaError(.fileReadNoSuchFile, userInfo: [NSFilePathErrorKey: source.path]) }
            let name = shot.appearance == "light" ? shot.screen : "\(shot.screen)-\(shot.appearance)"
            let destination = output.appendingPathComponent(String(format: "%02d-%@.png", index + 1, name))
            try render(Frame(shot: shot, screen: screen), size: canvas, to: destination)
            framed.append(NSImage(contentsOf: destination)!)
            print("Framed \(destination.path)")
        }
        if let overview {
            try files.createDirectory(at: overview.deletingLastPathComponent(), withIntermediateDirectories: true)
            let count = CGFloat(framed.count)
            let width: CGFloat = 160 + 440 * count + 48 * (count - 1)
            let size = CGSize(width: width, height: 1116)
            try render(Overview(frames: framed), size: size, to: overview)
            print("Overview \(overview.path)")
        }
    }
}
#else
import Foundation

@main struct RFrame {
    static func main() {
        FileHandle.standardError.write(Data("rframe renders with AppKit and only runs on macOS.\n".utf8))
        exit(1)
    }
}
#endif
