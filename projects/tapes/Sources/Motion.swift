// Motion between pages on the Mac and Apple TV: posters glide to the same item's place on the
// next tab, and on the Mac a poster's artwork flies into its detail page and back. iPhone has
// the system's tab bar and zoom transition instead. With Reduce Motion, pages just fade.
import SwiftUI

/// Where a page's cells sit, set by the Mac and Apple TV tabs; nil on iPhone.
struct PageScope {
  let page: Page
  let morph: Namespace.ID
  /// True for the page showing at its first screen: its cells are the ones the others glide to.
  let leads: Bool
}

extension EnvironmentValues {
  @Entry var pageScope: PageScope? = nil
}

extension CoordinateSpaceProtocol where Self == NamedCoordinateSpace {
  /// A detail page's own space, which `DetailScaffold` sets up.
  static var detailPage: Self { .named("detailPage") }
}

extension View {
  /// A library cell (`id` is its item) that glides between tabs and, on the Mac, flies into
  /// its detail page.
  func libraryCell(_ id: String) -> some View {
    modifier(LibraryCell(id: id))
  }
}

private struct LibraryCell: ViewModifier {
  @Environment(\.pageScope) private var scope
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  let id: String

  func body(content: Content) -> some View {
    if let scope, !reduceMotion {
      content
        #if os(macOS)
          .modifier(HeroSource(key: Hero.Key(page: scope.page, id: id)))
        #endif
        .matchedGeometryEffect(id: id, in: scope.morph, isSource: scope.leads)
    } else {
      content
    }
  }
}

#if os(macOS)
  extension EnvironmentValues {
    @Entry var hero: Hero? = nil
  }

  /// The artwork flying between a poster and its detail page. Cells report where their artwork
  /// sits; a click marks the departure, and the detail page's artwork reports where to land.
  @MainActor @Observable final class Hero {
    struct Key: Hashable {
      let page: Page
      let id: String
    }

    struct Flight: Equatable {
      let id: String
      let from: CGRect
      /// Updated while flying if the detail page's artwork moves as the page settles.
      var to: CGRect
      /// True flying into the detail page, false flying back to the poster.
      let opening: Bool
      let serial = UUID()
    }

    private(set) var flight: Flight?
    /// Each cell's artwork frame in window coordinates, per page.
    @ObservationIgnored var frames: [Key: CGRect] = [:]
    /// Where the pages start in the window.
    @ObservationIgnored var origin: CGPoint = .zero
    @ObservationIgnored private var departing: Key?
    /// The detail page open now, and where its artwork sits, for the flight back.
    @ObservationIgnored private var landed: (key: Key, frame: CGRect)?

    func depart(_ key: Key) { departing = key }

    /// The detail page's artwork for `id` sits at `frame`.
    func arrive(_ id: String, at frame: CGRect) {
      if let key = departing, key.id == id, let from = frames[key] {
        departing = nil
        landed = (key, frame)
        flight = Flight(id: id, from: from, to: frame, opening: true)
      } else if landed?.key.id == id {
        landed?.frame = frame
        if flight?.id == id && flight?.opening == true { flight?.to = frame }
      }
    }

    /// `page` is back at its first screen: fly the open detail page's artwork back to its poster.
    func close(to page: Page) {
      guard let landed, landed.key.page == page else { return }
      self.landed = nil
      guard let to = frames[landed.key] else { return }
      flight = Flight(id: landed.key.id, from: landed.frame, to: to, opening: false)
    }

    func finish(_ done: Flight) {
      if flight?.serial == done.serial { flight = nil }
    }
  }

  extension EnvironmentValues {
    /// The cell the artwork below belongs to, for `heroArtwork()`.
    @Entry var heroKey: Hero.Key? = nil
  }

  /// Tells the cell's link and artwork which cell they are.
  private struct HeroSource: ViewModifier {
    let key: Hero.Key

    func body(content: Content) -> some View {
      content.environment(\.heroKey, key)
    }
  }

  extension View {
    /// A cell's artwork: reports where it sits and hides while its copy flies.
    func heroArtwork() -> some View { modifier(HeroArtwork()) }
  }

  private struct HeroArtwork: ViewModifier {
    @Environment(\.hero) private var hero
    @Environment(\.heroKey) private var key

    func body(content: Content) -> some View {
      if let hero, let key {
        content
          .onGeometryChange(for: CGRect.self) { $0.frame(in: .global) } action: {
            hero.frames[key] = $0
          }
          .opacity(hero.flight?.id == key.id ? 0 : 1)
      } else {
        content
      }
    }
  }

  extension View {
    /// The detail page's artwork: where a flight from a poster lands.
    func heroDestination(_ id: String) -> some View { modifier(HeroDestination(id: id)) }
  }

  private struct HeroDestination: ViewModifier {
    @Environment(\.hero) private var hero
    let id: String

    func body(content: Content) -> some View {
      if let hero {
        content
          // Measured within the page, not the window: the Mac still slides a new page in
          // from the right out of sight, and the window position starts a page-width off.
          .onGeometryChange(for: CGRect.self) { $0.frame(in: .detailPage) } action: {
            hero.arrive(id, at: $0.offsetBy(dx: hero.origin.x, dy: hero.origin.y))
          }
          .opacity(hero.flight?.id == id ? 0 : 1)
      } else {
        content
      }
    }
  }

  /// Draws the flying artwork above the pages.
  struct HeroOverlay: View {
    @Environment(\.hero) private var hero

    var body: some View {
      GeometryReader { geo in
        if let hero, let flight = hero.flight {
          HeroFlight(flight: flight, origin: geo.frame(in: .global).origin) {
            hero.finish(flight)
          }
          .id(flight.serial)
        }
      }
      .allowsHitTesting(false)
      // Detail pages fill the same area as the pages, so this places their artwork in the window.
      .onGeometryChange(for: CGPoint.self) { $0.frame(in: .global).origin } action: {
        hero?.origin = $0
      }
    }
  }

  private struct HeroFlight: View {
    let flight: Hero.Flight
    let origin: CGPoint
    let done: () -> Void
    @State private var there = false

    var body: some View {
      let frame = there ? flight.to : flight.from
      // The detail page's artwork is rounder and casts a shadow; a poster's doesn't.
      let detail = there == flight.opening
      Artwork(seed: flight.id, small: false)
        .clipShape(.rect(cornerRadius: detail ? 20 : Metrics.corner))
        .shadow(radius: detail ? 30 : 0, y: detail ? 10 : 0)
        .frame(width: frame.width, height: frame.height)
        .position(x: frame.midX - origin.x, y: frame.midY - origin.y)
        .animation(.smooth(duration: 0.3), value: flight.to)
        .onAppear {
          withAnimation(.smooth(duration: 0.45)) { there = true } completion: { done() }
        }
    }
  }
#endif
