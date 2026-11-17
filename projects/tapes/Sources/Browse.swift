// The chosen structure: a Home page, then a page per section. Apple TV and Mac have a tab bar
// across the top; iPhone has the bottom tab bar (a sidebar on wide screens).
import SwiftUI

struct RootTabs: View {
  @Namespace private var zoom
  @State private var query = ""

  var body: some View {
    TabView {
      Tab {
        NavigationStack { HomeView(zoom: zoom).libraryDestinations(zoom) }
      } label: {
        TabLabel(title: "Home", systemImage: "house")
      }
      ForEach(LibrarySection.allCases) { section in
        Tab {
          NavigationStack { SectionGrid(section: section, zoom: zoom).libraryDestinations(zoom) }
        } label: {
          TabLabel(title: section.rawValue, systemImage: section.symbol)
        }
      }
      Tab(role: .search) {
        NavigationStack {
          #if os(macOS)
            // The Mac's own search field would sit at the right of the toolbar on every page,
            // apart from the Search tab, so the field lives at the top of this page instead.
            VStack(spacing: 0) {
              SearchField(query: $query)
              SearchResults(query: query)
            }
            .navigationTitle("Search")
            .libraryDestinations(zoom)
          #else
            SearchResults(query: query).navigationTitle("Search").libraryDestinations(zoom)
              #if os(tvOS)
                .searchable(text: $query, prompt: "Movies, shows and DJs")
              #endif
          #endif
        }
      }
    }
    #if os(iOS)
      .tabViewStyle(.sidebarAdaptable)
      // On iPhone the search tab turns into the search field, so the field belongs to the tab view.
      .searchable(text: $query, prompt: "Movies, shows and DJs")
      .tabBarMinimizeBehavior(.onScrollDown)
    #else
      .tabViewStyle(.tabBarOnly)
    #endif
  }
}

/// A tab's icon and title side by side; the Apple TV and Mac top tab bar otherwise shows titles only.
private struct TabLabel: View {
  let title: String
  let systemImage: String

  var body: some View {
    HStack(spacing: 6) {
      Image(systemName: systemImage)
      Text(title)
    }
  }
}

// MARK: - Home

struct HomeView: View {
  @Environment(Store.self) private var store
  let zoom: Namespace.ID

  var body: some View {
    LibraryPage(title: "Home", empty: store.isEmpty ? .library : nil) { shelves }
  }

  private var shelves: some View {
    VStack(alignment: .leading, spacing: Metrics.spacing * 2) {
      if !store.available {
        Label(
          "The library on the NAS can't be read right now. This is what was there last time.",
          systemImage: "externaldrive.badge.exclamationmark"
        )
        .font(.footnote)
        .foregroundStyle(.secondary)
        .padding(.horizontal, Metrics.gutter)
      }
      if let first = store.continueWatching.first {
        ContinueCard(item: first, eyebrow: "Continue Watching").padding(.horizontal, Metrics.gutter)
      } else if let pick = store.featured() {
        ContinueCard(item: pick, eyebrow: "From the Library").padding(.horizontal, Metrics.gutter)
      }
      if store.continueWatching.count > 1 {
        Shelf(title: "Continue Watching") {
          ForEach(store.continueWatching.dropFirst()) { item in
            Button {
              store.play(item)
            } label: {
              WideCell(seed: item.artID, title: item.title, detail: item.detail, watchID: item.id)
                .frame(width: Metrics.wide)
            }
            .artworkButton()
          }
        }
      }
      if !store.movies.isEmpty {
        Shelf(title: "Movies") {
          ForEach(store.movies) { movie in
            NavigationLink(value: movie) {
              PosterCell(seed: movie.id, title: movie.title, watchID: movie.id).frame(
                width: Metrics.poster)
            }
            .artworkButton()
            .zoomSource(movie.id, in: zoom)
          }
        }
      }
      if !store.shows.isEmpty {
        Shelf(title: "Shows") {
          ForEach(store.shows) { show in
            NavigationLink(value: show) {
              PosterCell(seed: show.id, title: show.title).frame(width: Metrics.poster)
            }
            .artworkButton()
            .zoomSource(show.id, in: zoom)
          }
        }
      }
      if !store.sets.isEmpty {
        Shelf(title: "DJ Sets") {
          ForEach(store.sets) { set in
            NavigationLink(value: set) {
              WideCell(seed: set.id, title: set.djLine, detail: set.title, watchID: set.id)
                .frame(width: Metrics.wide)
            }
            .artworkButton()
            .zoomSource(set.id, in: zoom)
          }
        }
      }
    }
    .padding(.vertical, Metrics.spacing)
  }
}

/// Every library page: a scroll view on the black page, with pull to refresh and the title. When
/// `empty` is set it fills the page instead of `content`.
private struct LibraryPage<Content: View>: View {
  @Environment(Store.self) private var store
  let title: String
  let empty: EmptyState?
  @ViewBuilder var content: Content

  var body: some View {
    ScrollView {
      if let empty {
        // Inside the scroll view, filling the page, so pull to refresh still works.
        empty.containerRelativeFrame([.horizontal, .vertical])
      } else {
        content
      }
    }
    .refreshable { await store.load() }
    .blackPage()
    #if !os(tvOS)
      .navigationTitle(title)
    #endif
  }
}

/// An empty page with a Refresh button. Apple TV needs something on the page to focus, or the
/// remote has nowhere to go and the sidebar can't be reopened.
private struct EmptyState: View {
  static let library = EmptyState(
    title: "Nothing Here Yet", systemImage: "film.stack",
    message: "Movies, shows and DJ sets appear here once they're imported into the library.")

  init(title: String, systemImage: String, message: String) {
    self.title = title
    self.systemImage = systemImage
    self.message = message
  }

  init(_ section: LibrarySection) {
    self.init(
      title: section.emptyTitle, systemImage: section.symbol, message: section.emptyMessage)
  }

  @Environment(Store.self) private var store
  let title: String
  let systemImage: String
  let message: String

  var body: some View {
    ContentUnavailableView {
      Label(title, systemImage: systemImage)
    } description: {
      Text(message)
    } actions: {
      Button("Refresh") { Task { await store.load() } }
    }
  }
}

private struct Shelf<Content: View>: View {
  let title: String
  @ViewBuilder var content: Content

  var body: some View {
    VStack(alignment: .leading, spacing: Metrics.spacing) {
      Text(title).font(.title2.bold()).padding(.horizontal, Metrics.gutter)
      ScrollView(.horizontal) {
        LazyHStack(alignment: .top, spacing: Metrics.spacing) { content }
          .padding(.horizontal, Metrics.gutter)
      }
      .scrollClipDisabled()
    }
    #if os(tvOS)
      // Up and down move between shelves even when nothing sits directly above or below,
      // as with a short shelf under the Play button.
      .focusSection()
    #endif
  }
}

/// The large card at the top of Home: the thing you were last watching, or a pick from the
/// library when nothing is in progress. `eyebrow` names which.
private struct ContinueCard: View {
  @Environment(Store.self) private var store
  @Environment(\.horizontalSizeClass) private var sizeClass
  let item: ContinueItem
  let eyebrow: String

  private var isWideArt: Bool {
    if case .set = item { return true }
    return false
  }

  var body: some View {
    if sizeClass == .compact { tall } else { banner }
  }

  private var text: some View {
    VStack(alignment: .leading, spacing: 6) {
      Text(item.title).font(.largeTitle.bold())
      Text(item.detail).font(.subheadline).foregroundStyle(.secondary)
    }
  }

  private func resume(fullWidth: Bool) -> some View {
    Button {
      store.play(item)
    } label: {
      Label(
        store.isInProgress(item.id)
          ? "Resume · \(runtime(store.minutesLeft(item.id, of: item.minutes))) left"
          : "Play · \(runtime(item.minutes))",
        systemImage: "play.fill"
      )
      .font(.headline)
      .frame(maxWidth: fullWidth ? .infinity : nil)
      .padding(.vertical, 6)
      .padding(.horizontal, fullWidth ? 0 : 28)
    }
    .buttonStyle(.glassProminent)
    .tint(.white)
    .foregroundStyle(.black)
  }

  /// iPhone: artwork fills the card, text and button over its lower half.
  private var tall: some View {
    Artwork(seed: item.artID, alignment: .top, small: false)
      .aspectRatio(4 / 5, contentMode: .fit)
      .overlay {
        LinearGradient(
          stops: [
            .init(color: .clear, location: 0.35),
            .init(color: .black.opacity(0.95), location: 0.82),
          ],
          startPoint: .top, endPoint: .bottom)
      }
      .overlay(alignment: .bottomLeading) {
        VStack(alignment: .leading, spacing: 16) {
          text
          resume(fullWidth: true)
        }
        .padding(20)
      }
      .clipShape(.rect(cornerRadius: 28))
  }

  /// Mac and Apple TV: artwork beside the text on a blurred wash of the same image.
  private var banner: some View {
    HStack(spacing: 40) {
      Artwork(seed: item.artID, small: false)
        .aspectRatio(isWideArt ? 16 / 9 : 2 / 3, contentMode: .fit)
        .frame(height: Metrics.poster * 1.5)
        .clipShape(.rect(cornerRadius: Metrics.corner))
        .shadow(radius: 20, y: 8)
      VStack(alignment: .leading, spacing: 20) {
        Text(eyebrow).font(.subheadline.weight(.semibold)).foregroundStyle(.secondary)
        text
        resume(fullWidth: false)
      }
      Spacer(minLength: 0)
    }
    .padding(40)
    .background {
      // Dark enough that light artwork (a mostly white poster) doesn't wash the card out grey.
      Artwork(seed: item.artID).blur(radius: 70)
        .overlay(.black.opacity(0.6))
        .overlay {
          LinearGradient(
            colors: [.black.opacity(0.5), .clear], startPoint: .leading, endPoint: .trailing)
        }
    }
    .clipShape(.rect(cornerRadius: 28))
  }
}

// MARK: - Section pages

struct SectionGrid: View {
  @Environment(Store.self) private var store
  let section: LibrarySection
  let zoom: Namespace.ID

  var body: some View {
    LibraryPage(title: section.rawValue, empty: store.isEmpty(section) ? EmptyState(section) : nil)
    {
      grid
    }
    .scrollClipDisabled()
  }

  private var grid: some View {
    Group {
      switch section {
      case .movies:
        LazyVGrid(columns: posterColumns, spacing: Metrics.spacing) {
          ForEach(store.movies) { movie in
            NavigationLink(value: movie) {
              PosterCell(seed: movie.id, title: movie.title, watchID: movie.id)
            }
            .artworkButton()
            .zoomSource(movie.id, in: zoom)
          }
        }
      case .shows:
        LazyVGrid(columns: posterColumns, spacing: Metrics.spacing) {
          ForEach(store.shows) { show in
            NavigationLink(value: show) { PosterCell(seed: show.id, title: show.title) }
              .artworkButton()
              .zoomSource(show.id, in: zoom)
          }
        }
      case .sets:
        LazyVGrid(
          columns: [GridItem(.adaptive(minimum: Metrics.wide * 0.75), spacing: Metrics.spacing)],
          spacing: Metrics.spacing * 1.5
        ) {
          ForEach(store.sets) { set in
            NavigationLink(value: set) {
              WideCell(seed: set.id, title: set.djLine, detail: set.title, watchID: set.id)
            }
            .artworkButton()
            .zoomSource(set.id, in: zoom)
          }
        }
      }
    }
    .padding(.horizontal, Metrics.gutter)
    .padding(.vertical, Metrics.spacing)
  }

  private var posterColumns: [GridItem] {
    [GridItem(.adaptive(minimum: Metrics.poster * 0.84), spacing: Metrics.spacing)]
  }
}

// MARK: - Search

#if os(macOS)
  /// The Mac search field, focused when the Search tab opens.
  private struct SearchField: View {
    @Binding var query: String
    @FocusState private var focused: Bool

    var body: some View {
      HStack(spacing: 8) {
        Image(systemName: "magnifyingglass").foregroundStyle(.secondary)
        TextField("Movies, shows and DJs", text: $query)
          .textFieldStyle(.plain)
          .focused($focused)
        if !query.isEmpty {
          Button("Clear", systemImage: "xmark.circle.fill") { query = "" }
            .labelStyle(.iconOnly)
            .buttonStyle(.plain)
            .foregroundStyle(.secondary)
        }
      }
      .font(.title3)
      .padding(.horizontal, 14)
      .padding(.vertical, 10)
      .background(Color(white: 0.14), in: .capsule)
      .padding(.horizontal, Metrics.gutter)
      .padding(.vertical, Metrics.spacing)
      .onAppear { focused = true }
    }
  }
#endif

struct SearchResults: View {
  @Environment(Store.self) private var store
  let query: String

  var body: some View {
    let movies = store.movies.filter { matches($0.title) }
    let shows = store.shows.filter { matches($0.title) }
    let sets = store.sets.filter { matches($0.title) || matches($0.djLine) }
    List {
      if !movies.isEmpty {
        Section("Movies") {
          ForEach(movies) { movie in
            NavigationLink(value: movie) {
              MediaRow(
                seed: movie.id, title: movie.title, detail: movie.year.map(String.init) ?? "")
            }
          }
        }
      }
      if !shows.isEmpty {
        Section("Shows") {
          ForEach(shows) { show in
            NavigationLink(value: show) {
              MediaRow(seed: show.id, title: show.title, detail: show.years ?? "")
            }
          }
        }
      }
      if !sets.isEmpty {
        Section("DJ Sets") {
          ForEach(sets) { set in
            NavigationLink(value: set) {
              MediaRow(seed: set.id, title: set.djLine, detail: set.title, wide: true)
            }
          }
        }
      }
    }
    .listStyle(.plain)
    #if os(macOS)
      // A plain Mac list runs to the window edge; line it up with the search field above.
      .contentMargins(.horizontal, Metrics.gutter - 8, for: .scrollContent)
    #endif
    .blackPage()
    .overlay {
      if movies.isEmpty && shows.isEmpty && sets.isEmpty {
        if store.isEmpty {
          EmptyState.library
        } else {
          ContentUnavailableView.search(text: query)
        }
      }
    }
  }

  private func matches(_ text: String) -> Bool {
    query.isEmpty || text.localizedCaseInsensitiveContains(query)
  }
}
