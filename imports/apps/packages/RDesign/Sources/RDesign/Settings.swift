#if canImport(SwiftUI)
import SwiftUI

/// A small (i) that shows a row's explanation in a popover, instead of footer text under it.
public struct InfoButton: View {
    let message: String
    @State private var showing = false
    public init(_ message: String) { self.message = message }
    public var body: some View {
        Button { showing = true } label: {
            Image(systemName: "info.circle").font(.body).foregroundStyle(.secondary).frame(width: 32, height: 32).contentShape(Rectangle())
        }
        .buttonStyle(.borderless)
        .accessibilityLabel("More information")
        .popover(isPresented: $showing, arrowEdge: .top) {
            Text(message).font(.footnote).multilineTextAlignment(.leading)
                .fixedSize(horizontal: false, vertical: true)
                .frame(width: 280, alignment: .leading)
                .padding(16)
                .presentationCompactAdaptation(.popover)
                .accessibilityIdentifier("infoPopover")
        }
    }
}

/// A settings row that opens a web page, such as the privacy policy or support page.
public struct RLinkRow: View {
    let title: String
    let systemImage: String
    let url: URL
    public init(_ title: String, systemImage: String, url: URL) { self.title = title; self.systemImage = systemImage; self.url = url }
    public var body: some View {
        Link(destination: url) { Label(title, systemImage: systemImage) }
    }
}

/// The privacy policy and support rows every -r app links to (site/<app>/privacy/ and /support/).
public struct RHelpLinks: View {
    let privacy: URL
    let support: URL
    public init(privacy: URL, support: URL) { self.privacy = privacy; self.support = support }
    public var body: some View {
        RLinkRow("Privacy policy", systemImage: "hand.raised", url: privacy)
        RLinkRow("Support", systemImage: "questionmark.circle", url: support)
    }
}

/// "<App> · <version>" under the last settings section, read from the bundle.
public struct RVersionFooter: View {
    let appName: String
    public init(_ appName: String) { self.appName = appName }
    public var body: some View {
        Text("\(appName) · \(Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "")")
            .frame(maxWidth: .infinity).padding(.top, RSpacing.s)
    }
}

/// The app's mark on its near-black tile (the launch glyph from the asset catalog), which reads in light and dark.
public struct RMark: View {
    let imageName: String
    let size: CGFloat
    public init(imageName: String = "LaunchGlyph", size: CGFloat = 72) { self.imageName = imageName; self.size = size }
    public var body: some View {
        Image(imageName).resizable().scaledToFit()
            .padding(size * 0.16)
            .frame(width: size, height: size)
            .background(RPalette.ink, in: RoundedRectangle(cornerRadius: size * 0.225, style: .continuous))
            .accessibilityHidden(true)
    }
}

/// A quiet launch surface using the app's own asset catalog glyph.
public struct RSplash: View {
    let imageName: String
    public init(imageName: String = "LaunchGlyph") { self.imageName = imageName }
    public var body: some View {
        ZStack {
            RPalette.background.ignoresSafeArea()
            RMark(imageName: imageName, size: 96)
        }
    }
}
#endif
