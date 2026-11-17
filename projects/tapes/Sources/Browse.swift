// The chosen structure: a Home page, then a page per section. Apple TV and Mac have their own
// bar across the top; iPhone has the bottom tab bar (a sidebar on wide screens).
import SwiftUI

struct RootTabs: View {
  var body: some View {
    #if os(iOS)
      SystemTabs()
    #else
      TopTabs()
    #endif
  }
}

/// The app's pages, in tab order.
enum Page: Hashable, CaseIterable {
  case home, movies, shows, sets, search

  var title: String {
    switch self {
    case .home: "Home"
    case .movies: LibrarySection.movies.rawValue
    case .shows: LibrarySection.shows.rawValue
    case .sets: LibrarySection.sets.rawValue
    case .search: "Search"
    }
  }

  var symbol: String {
    switch self {
    case .home: "house"
    case .movies: LibrarySection.movies.symbol
    case .shows: LibrarySection.shows.symbol
    case .sets: LibrarySection.sets.symbol
    case .search: "magnifyingglass"
    }
  }
}

/// One page with its own navigation, so it keeps its place when another tab is chosen. The paths
/// belong to the tabs, so a Top Shelf link can open a page on Home and the Apple TV bar can hide.
private struct PageStack: View {
  let page: Page
  @Binding var query: String
  var searchActive = false
  let zoom: Namespace.ID
  @Binding var path: NavigationPath

  var body: some View {
    NavigationStack(path: $path) {
      switch page {
      case .home: HomeView(zoom: zoom).libraryDestinations(zoom)
      case .movies: SectionGrid(section: .movies, zoom: zoom).libraryDestinations(zoom)
      case .shows: SectionGrid(section: .shows, zoom: zoom).libraryDestinations(zoom)
      case .sets: SectionGrid(section: .sets, zoom: zoom).libraryDestinations(zoom)
      case .search:
        #if os(macOS)
          VStack(spacing: 0) {
            SearchField(query: $query, active: searchActive)
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
}

/// Follows a `tapes://open` link: switches to Home and shows the linked page there.
private struct FollowsLinks: ViewModifier {
  @Environment(Store.self) private var store
  @Binding var page: Page
  @Binding var homePath: NavigationPath

  func body(content: Content) -> some View {
    content.onChange(of: store.linkedPage, initial: true) { _, linked in
      guard let linked else { return }
      var path = NavigationPath()
      switch linked {
      case .movie(let movie): path.append(movie)
      case .show(let show): path.append(show)
      case .set(let set): path.append(set)
      }
      page = .home
      homePath = path
      store.linkedPage = nil
    }
  }
}

#if os(iOS)
  /// iPhone's bottom tab bar (a sidebar on wide screens).
  private struct SystemTabs: View {
    @Namespace private var zoom
    @State private var query = ""
    @State private var page = Page.home
    @State private var paths: [Page: NavigationPath] = [:]

    var body: some View {
      TabView(selection: $page) {
        ForEach([Page.home, .movies, .shows, .sets], id: \.self) { each in
          Tab(value: each) {
            PageStack(page: each, query: $query, zoom: zoom, path: $paths.path(each))
          } label: {
            Label(each.title, systemImage: each.symbol)
          }
        }
        Tab(value: Page.search, role: .search) {
          PageStack(page: .search, query: $query, zoom: zoom, path: $paths.path(.search))
        } label: {
          Label("Search", systemImage: "magnifyingglass")
        }
      }
      .tabViewStyle(.sidebarAdaptable)
      // On iPhone the search tab turns into the search field, so the field belongs to the tab view.
      .searchable(text: $query, prompt: "Movies, shows and DJs")
      .tabBarMinimizeBehavior(.onScrollDown)
      .modifier(FollowsLinks(page: $page, homePath: $paths.path(.home)))
    }
  }
#else
  /// Mac and Apple TV draw their own bar across the top. The Mac's system tab bar shows titles
  /// only, with no icons, and Apple TV's scrolls away with the page; this one stays put. Every
  /// page stays alive underneath, so each keeps its place between tabs.
  private struct TopTabs: View {
    @Namespace private var zoom
    @State private var page = Page.home
    @State private var query = ""
    @State private var paths: [Page: NavigationPath] = [:]
    #if os(tvOS)
      @FocusState private var barFocus: Page?
    #endif

    /// True on a page's first screen; opening a movie or show hides the Apple TV bar.
    private var atRoot: Bool { paths[page]?.isEmpty ?? true }

    var body: some View {
      bar.modifier(FollowsLinks(page: $page, homePath: $paths.path(.home)))
    }

    @ViewBuilder private var bar: some View {
      #if os(macOS)
        pages
          .toolbar {
            ToolbarItem(placement: .principal) {
              // A little below the window buttons' line, so the bar has room above it.
              TopBar(page: $page).offset(y: 6)
            }
            .sharedBackgroundVisibility(.hidden)
          }
      #else
        VStack(spacing: 0) {
          if atRoot {
            TopBar(page: $page, focus: $barFocus)
              .padding(.bottom, Metrics.spacing)
              // Above the page, so posters scrolling up pass beneath it.
              .zIndex(1)
              .transition(.move(edge: .top).combined(with: .opacity))
          }
          pages
        }
        .animation(.easeInOut(duration: 0.25), value: atRoot)
        // Menu on a page's first screen goes back up to the bar, as with the system tab bar.
        .onExitCommand(perform: atRoot && barFocus == nil ? { barFocus = page } : nil)
      #endif
    }

    private var pages: some View {
      ZStack {
        ForEach(Page.allCases, id: \.self) { each in
          let shown = each == page
          PageStack(
            page: each, query: $query, searchActive: shown, zoom: zoom, path: $paths.path(each)
          )
          .opacity(shown ? 1 : 0)
          .allowsHitTesting(shown)
          .accessibilityHidden(!shown)
          #if os(tvOS)
            // The remote can only reach the page that is showing.
            .disabled(!shown)
          #endif
        }
      }
      .animation(.easeInOut(duration: 0.2), value: page)
    }
  }

  /// Icon then name for each page; Search is just the magnifying glass. A white pill with dark
  /// text marks the chosen page and slides to the new tab when the page changes. On the Mac,
  /// Command-1 to 5 switch; on Apple TV, moving focus onto a tab opens its page.
  private struct TopBar: View {
    @Binding var page: Page
    #if os(tvOS)
      var focus: FocusState<Page?>.Binding
    #endif
    @Namespace private var pill

    /// Apple TV dims the pill while focus is down on the page, so it's clear the bar isn't
    /// focused; the Mac's bar is always the white pill.
    private var lit: Bool {
      #if os(tvOS)
        focus.wrappedValue != nil
      #else
        true
      #endif
    }

    var body: some View {
      GlassEffectContainer {
        HStack(spacing: 2) {
          ForEach(Array(Page.allCases.enumerated()), id: \.element) { index, each in
            let chosen = each == page
            Button {
              withAnimation(.spring(duration: 0.35, bounce: 0.2)) { page = each }
            } label: {
              if each == .search {
                Image(systemName: each.symbol).accessibilityLabel(each.title)
              } else {
                Label(each.title, systemImage: each.symbol).labelStyle(.titleAndIcon)
              }
            }
            #if os(tvOS)
              // Focus shows as the pill itself, not the system's lift.
              .buttonStyle(BarButton())
              .focused(focus, equals: each)
            #else
              .buttonStyle(.plain)
              .keyboardShortcut(KeyEquivalent(Character(String(index + 1))), modifiers: .command)
            #endif
            .font(.body.weight(.semibold))
            .foregroundStyle(chosen && lit ? Color.black : Color.white)
            .padding(.horizontal, each == .search ? 10 : 14)
            .padding(.vertical, 6)
            .background {
              if chosen {
                Capsule().fill(.white.opacity(lit ? 1 : 0.2))
                  .matchedGeometryEffect(id: "pill", in: pill)
              }
            }
            .contentShape(.capsule)
          }
        }
        .padding(4)
        .glassEffect(.regular, in: .capsule)
      }
      #if os(tvOS)
        .focusSection()
        // Coming up from the page lands on the chosen tab, and moving along the bar opens pages.
        .defaultFocus(focus, page, priority: .userInitiated)
        .onChange(of: focus.wrappedValue) { _, now in
          if let now, now != page {
            withAnimation(.spring(duration: 0.35, bounce: 0.2)) { page = now }
          }
        }
      #endif
    }
  }

  #if os(tvOS)
    /// Just the label: the bar draws focus as its pill.
    private struct BarButton: ButtonStyle {
      func makeBody(configuration: Configuration) -> some View { configuration.label }
    }
  #endif
#endif

extension Binding<[Page: NavigationPath]> {
  /// One page's navigation path, empty until something is opened.
  func path(_ page: Page) -> Binding<NavigationPath> {
    Binding<NavigationPath>(
      get: { wrappedValue[page] ?? NavigationPath() },
      set: { wrappedValue[page] = $0 })
  }
}

// MARK: - Home

struct HomeView: View {
  @Environment(Store.self) private var store
  let zoom: Namespace.ID

  var body: some View {
    LibraryPage(title: "Home", empty: store.isEmpty ? .library : nil, footer: store.summary) {
      shelves
    }
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
      let moreToContinue = Array(store.continueWatching.dropFirst())
      if !moreToContinue.isEmpty {
        Shelf(title: "Continue Watching", items: moreToContinue) { item in
          Button {
            store.play(item)
          } label: {
            WideCell(seed: item.artID, title: item.title, detail: item.detail, watchID: item.id)
              .frame(width: Metrics.wide)
          }
          .artworkButton()
        }
      }
      if !store.movies.isEmpty {
        Shelf(title: "Movies", items: store.movies) { movie in
          NavigationLink(value: movie) {
            PosterCell(seed: movie.id, title: movie.title, watchID: movie.id).frame(
              width: Metrics.poster)
          }
          .artworkButton()
          .zoomSource(movie.id, in: zoom)
        }
      }
      if !store.shows.isEmpty {
        Shelf(title: "Shows", items: store.shows) { show in
          NavigationLink(value: show) {
            PosterCell(seed: show.id, title: show.title).frame(width: Metrics.poster)
          }
          .artworkButton()
          .zoomSource(show.id, in: zoom)
        }
      }
      if !store.sets.isEmpty {
        Shelf(title: "DJ Sets", items: store.sets) { set in
          NavigationLink(value: set) {
            WideCell(seed: set.id, title: set.djLine, detail: set.title, watchID: set.id)
              .frame(width: Metrics.wide)
          }
          .artworkButton()
          .zoomSource(set.id, in: zoom)
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
  /// A quiet line at the very end of the page, such as the item count and total size.
  var footer: String?
  @ViewBuilder var content: Content

  var body: some View {
    ScrollView {
      if let empty {
        // Inside the scroll view, filling the page, so pull to refresh still works.
        empty.containerRelativeFrame([.horizontal, .vertical])
      } else {
        content
        if let footer {
          Text(footer)
            .font(.footnote)
            .foregroundStyle(.secondary)
            .frame(maxWidth: .infinity)
            .padding(.top, Metrics.spacing)
            .padding(.bottom, Metrics.spacing * 2)
        }
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

private struct Shelf<Item: Identifiable, Cell: View>: View {
  let title: String
  let items: [Item]
  @ViewBuilder var cell: (Item) -> Cell
  #if os(tvOS)
    @FocusState private var focused: Item.ID?
  #endif

  var body: some View {
    VStack(alignment: .leading, spacing: Metrics.spacing) {
      Text(title).font(.title2.bold()).padding(.horizontal, Metrics.gutter)
      ScrollView(.horizontal) {
        LazyHStack(alignment: .top, spacing: Metrics.spacing) {
          ForEach(items) { item in
            cell(item)
              #if os(tvOS)
                .focused($focused, equals: item.id)
              #endif
          }
        }
        .padding(.horizontal, Metrics.gutter)
      }
      .scrollClipDisabled()
    }
    #if os(tvOS)
      // Up and down move between shelves even when nothing sits directly above or below,
      // as with a short shelf under the Play button, and always arrive at the first item.
      .focusSection()
      .defaultFocus($focused, items.first?.id, priority: .userInitiated)
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
    #if os(tvOS)
      // Up from any shelf reaches the Play button, wherever it sits across the card.
      .focusSection()
    #endif
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
  /// Apple TV's focused grid item; unused elsewhere.
  @FocusState private var focused: String?

  /// The grid's first item, where focus lands coming down from the bar.
  private var firstID: String? {
    switch section {
    case .movies: store.movies.first?.id
    case .shows: store.shows.first?.id
    case .sets: store.sets.first?.id
    }
  }

  var body: some View {
    LibraryPage(
      title: section.rawValue, empty: store.isEmpty(section) ? EmptyState(section) : nil,
      footer: store.summary(section)
    ) {
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
            .gridFocus($focused, movie.id)
            .zoomSource(movie.id, in: zoom)
          }
        }
      case .shows:
        LazyVGrid(columns: posterColumns, spacing: Metrics.spacing) {
          ForEach(store.shows) { show in
            NavigationLink(value: show) { PosterCell(seed: show.id, title: show.title) }
              .artworkButton()
              .gridFocus($focused, show.id)
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
            .gridFocus($focused, set.id)
            .zoomSource(set.id, in: zoom)
          }
        }
      }
    }
    .padding(.horizontal, Metrics.gutter)
    .padding(.vertical, Metrics.spacing)
    #if os(tvOS)
      // Coming down from the bar lands on the first item, not whichever sits under the tab.
      .focusSection()
      .defaultFocus($focused, firstID, priority: .userInitiated)
    #endif
  }

  private var posterColumns: [GridItem] {
    [GridItem(.adaptive(minimum: Metrics.poster * 0.84), spacing: Metrics.spacing)]
  }
}

extension View {
  /// Apple TV tracks which grid item has focus, so focus arriving from the bar can pick the first.
  @ViewBuilder fileprivate func gridFocus(_ focused: FocusState<String?>.Binding, _ id: String)
    -> some View
  {
    #if os(tvOS)
      self.focused(focused, equals: id)
    #else
      self
    #endif
  }
}

// MARK: - Search

#if os(macOS)
  /// The Mac search field, focused when the Search tab opens.
  private struct SearchField: View {
    @Binding var query: String
    /// True while the Search tab is showing; the field takes focus each time it opens.
    let active: Bool
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
      .onAppear { focused = active }
      .onChange(of: active) { _, now in focused = now }
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
