// Artwork loading, per-platform sizes and the shared cells.
import SwiftUI

/// Sizes that differ between iPhone, Mac and Apple TV.
enum Metrics {
  #if os(tvOS)
    static let poster: CGFloat = 250
    static let wide: CGFloat = 440
    static let spacing: CGFloat = 40
    static let gutter: CGFloat = 0  // tvOS already insets content for overscan.
    static let detailPoster: CGFloat = 420
    static let detailWide: CGFloat = 760
    static let corner: CGFloat = 16
    static let caption: CGFloat = 18  // room for the focused artwork to grow
  #elseif os(macOS)
    static let poster: CGFloat = 160
    static let wide: CGFloat = 280
    static let spacing: CGFloat = 18
    static let gutter: CGFloat = 28
    static let detailPoster: CGFloat = 280
    static let detailWide: CGFloat = 480
    static let corner: CGFloat = 12
    static let caption: CGFloat = 6
  #else
    static let poster: CGFloat = 124
    static let wide: CGFloat = 220
    static let spacing: CGFloat = 12
    static let gutter: CGFloat = 16
    static let detailPoster: CGFloat = 300
    static let detailWide: CGFloat = 480
    static let corner: CGFloat = 12
    static let caption: CGFloat = 6
  #endif
}

/// Artwork downloaded from the server, kept in memory for the session.
@MainActor
final class ImageCache {
  static let shared = ImageCache()
  private var images: [URL: Image] = [:]
  private var failed: Set<URL> = []
  private var loading: [URL: Task<Image?, Never>] = [:]

  func cached(_ url: URL) -> Image? { images[url] }
  func hasFailed(_ url: URL) -> Bool { failed.contains(url) }

  func image(for url: URL) async -> Image? {
    if let image = images[url] { return image }
    if failed.contains(url) { return nil }
    if let task = loading[url] { return await task.value }
    let task = Task<Image?, Never> {
      guard let (data, response) = try? await URLSession.shared.data(from: url),
        (response as? HTTPURLResponse)?.statusCode == 200
      else { return nil }
      #if os(macOS)
        return NSImage(data: data).map { Image(nsImage: $0) }
      #else
        return UIImage(data: data).map { Image(uiImage: $0) }
      #endif
    }
    loading[url] = task
    let image = await task.value
    loading[url] = nil
    if let image { images[url] = image } else { failed.insert(url) }
    return image
  }

  /// Forget failures so artwork added since is tried again.
  func retryFailures() { failed.removeAll() }
}

/// The item's artwork, filling whatever frame it is given. Shimmers while it downloads; with no
/// artwork it falls back to a flat tile with the title. `small` asks for the grid-sized image;
/// detail pages use the full one.
struct Artwork: View {
  @Environment(Store.self) private var store
  let seed: String
  var title: String?
  var alignment: Alignment = .center
  var small = true
  @State private var loaded: Image?
  @State private var failed = false

  var body: some View {
    let url = store.server.artURL(seed, small: small)
    Group {
      if let image = loaded ?? ImageCache.shared.cached(url) {
        Color.clear
          .overlay(alignment: alignment) { image.resizable().scaledToFill() }
          .clipped()
      } else if failed || ImageCache.shared.hasFailed(url) {
        Color(white: 0.14)
          .overlay {
            Text(title ?? "").font(.headline).multilineTextAlignment(.center).padding(8)
          }
      } else {
        Shimmer()
      }
    }
    .task(id: url) {
      failed = false
      loaded = await ImageCache.shared.image(for: url)
      failed = loaded == nil
    }
  }
}

/// The loading placeholder: the artwork tile's grey with a soft light sweeping across it.
/// Holds still when Reduce Motion is on.
struct Shimmer: View {
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @State private var sweeping = false

  var body: some View {
    Color(white: 0.14)
      .overlay {
        if !reduceMotion {
          GeometryReader { geo in
            LinearGradient(
              colors: [.clear, .white.opacity(0.07), .clear],
              startPoint: .leading, endPoint: .trailing
            )
            .frame(width: geo.size.width)
            .offset(x: sweeping ? geo.size.width : -geo.size.width)
          }
          .onAppear {
            withAnimation(.linear(duration: 1.4).repeatForever(autoreverses: false)) {
              sweeping = true
            }
          }
        }
      }
      .clipped()
      .accessibilityLabel("Loading")
  }
}

struct WatchProgressBar: View {
  let fraction: Double
  var body: some View {
    Capsule().fill(.white.opacity(0.3))
      .frame(height: 4)
      .overlay(alignment: .leading) {
        GeometryReader { geo in
          Capsule().fill(.white).frame(width: geo.size.width * fraction)
        }
      }
  }
}

/// Watched tick or progress bar laid over a piece of artwork.
private struct WatchOverlay: ViewModifier {
  @Environment(Store.self) private var store
  let id: String?

  func body(content: Content) -> some View {
    content
      .overlay(alignment: .topTrailing) {
        if let id, store.isWatched(id) {
          Image(systemName: "checkmark.circle.fill")
            .font(.body)
            .symbolRenderingMode(.palette)
            .foregroundStyle(.black, .white)
            .shadow(radius: 3)
            .padding(6)
        }
      }
      .overlay(alignment: .bottom) {
        if let id, store.isInProgress(id) {
          WatchProgressBar(fraction: store.fraction(id))
            .padding(8)
            .background(
              LinearGradient(
                colors: [.clear, .black.opacity(0.6)], startPoint: .top, endPoint: .bottom))
        }
      }
  }
}

/// 2:3 poster with its title and year beneath. `watchID` is the item whose watched state it shows.
struct PosterCell: View {
  let seed: String
  let title: String
  /// "2010" for a movie, "2005–2013" for a show.
  var detail: String?
  var watchID: String?

  var body: some View {
    VStack(alignment: .leading, spacing: Metrics.caption) {
      Artwork(seed: seed, title: title)
        .aspectRatio(2 / 3, contentMode: .fit)
        .modifier(WatchOverlay(id: watchID))
        .clipShape(.rect(cornerRadius: Metrics.corner))
        .focusLift()
      Text(title).font(.subheadline.weight(.semibold)).lineLimit(1)
      if let detail {
        Text(detail).font(.footnote).foregroundStyle(.secondary).lineLimit(1)
      }
    }
    // One element read as the title and year, not "Selected" plus the caption.
    .accessibilityElement(children: .ignore)
    .accessibilityLabel([title, detail].compactMap { $0 }.joined(separator: ", "))
  }
}

/// 16:9 thumbnail with a two-line caption beneath.
struct WideCell: View {
  let seed: String
  let title: String
  let detail: String
  var watchID: String?

  var body: some View {
    VStack(alignment: .leading, spacing: Metrics.caption) {
      Artwork(seed: seed, title: title)
        .aspectRatio(16 / 9, contentMode: .fit)
        .modifier(WatchOverlay(id: watchID))
        .clipShape(.rect(cornerRadius: Metrics.corner))
        .focusLift()
      Text(title).font(.subheadline.weight(.semibold)).lineLimit(1)
      Text(detail).font(.footnote).foregroundStyle(.secondary).lineLimit(1)
    }
  }
}

/// Compact list row with a small thumbnail.
struct MediaRow: View {
  let seed: String
  let title: String
  let detail: String
  var wide = false

  var body: some View {
    HStack(spacing: 12) {
      Artwork(seed: seed)
        .frame(width: wide ? 88 : 44, height: wide ? 50 : 66)
        .clipShape(.rect(cornerRadius: 6))
      VStack(alignment: .leading, spacing: 2) {
        Text(title).font(.body.weight(.medium)).lineLimit(1)
        Text(detail).font(.subheadline).foregroundStyle(.secondary).lineLimit(1)
      }
    }
  }
}

extension View {
  /// Artwork buttons: no plate behind the label on any platform. On Apple TV the artwork inside
  /// lifts on focus (`focusLift`); the card style was dropped because its grey plate squared off
  /// the focused corners and left the caption with no padding.
  @ViewBuilder func artworkButton() -> some View {
    #if os(tvOS)
      self.buttonStyle(.borderless)
    #else
      self.buttonStyle(.plain)
    #endif
  }

  /// Apple TV's lift, tilt and shine for focused artwork; it follows the clip shape applied before it.
  @ViewBuilder func focusLift() -> some View {
    #if os(tvOS)
      self.hoverEffect(.highlight)
    #else
      self
    #endif
  }

  /// Zoom out of the tapped artwork where the platform supports it.
  @ViewBuilder func zoomDestination(_ id: String, in namespace: Namespace.ID) -> some View {
    #if os(macOS) || os(tvOS)
      self
    #else
      self.navigationTransition(.zoom(sourceID: id, in: namespace))
    #endif
  }

  /// Not on Apple TV: marking a poster as a zoom source there squares off its corners when focused.
  @ViewBuilder func zoomSource(_ id: String, in namespace: Namespace.ID) -> some View {
    #if os(macOS) || os(tvOS)
      self
    #else
      self.matchedTransitionSource(id: id, in: namespace)
    #endif
  }

  /// The plain black page every screen sits on, on every platform.
  @ViewBuilder func blackPage() -> some View {
    #if os(macOS)
      self.scrollContentBackground(.hidden).background(.black).containerBackground(
        .black, for: .window)
    #elseif os(tvOS)
      self.background(Color.black.ignoresSafeArea())
    #else
      self.scrollContentBackground(.hidden).background(Color.black.ignoresSafeArea())
    #endif
  }

  @ViewBuilder func inlineTitle() -> some View {
    #if os(iOS)
      self.navigationBarTitleDisplayMode(.inline)
    #else
      self
    #endif
  }
}
