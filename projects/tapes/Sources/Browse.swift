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

/// The app's pages, in the order of the Mac and Apple TV bar: Search first, as in the TV app.
enum Page: Hashable, CaseIterable {
  case search, home, movies, shows, sets, settings

  /// The Mac's Command-key shortcut: 1 to 4 for the library pages, F for Search, comma for Settings.
  var shortcut: KeyEquivalent {
    switch self {
    case .home: "1"
    case .movies: "2"
    case .shows: "3"
    case .sets: "4"
    case .search: "f"
    case .settings: ","
    }
  }

  /// Search and Settings show just their icon in the bar.
  var iconOnly: Bool { self == .search || self == .settings }

  var title: String {
    switch self {
    case .home: "Home"
    case .movies: LibrarySection.movies.rawValue
    case .shows: LibrarySection.shows.rawValue
    case .sets: LibrarySection.sets.rawValue
    case .search: "Search"
    case .settings: "Settings"
    }
  }

  var symbol: String {
    switch self {
    case .home: "house"
    case .movies: LibrarySection.movies.symbol
    case .shows: LibrarySection.shows.symbol
    case .sets: LibrarySection.sets.symbol
    case .search: "magnifyingglass"
    case .settings: "gearshape"
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
      case .settings: SettingsView()
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
        ForEach([Page.home, .movies, .shows, .sets, .settings], id: \.self) { each in
          Tab(value: each) {
            PageStack(page: each, query: $query, zoom: zoom, path: $paths.path(each))
          } label: {
            Label(each.title, systemImage: each.symbol)
          }
        }
        Tab(value: Page.search, role: .search) {
          PageStack(page: .search, query: $query, zoom: zoom, path: $paths.path(.search))
            // On the Search tab only, so Home and the other pages have no search field.
            .searchable(text: $query, prompt: "Movies, shows and DJs")
        } label: {
          Label("Search", systemImage: "magnifyingglass")
        }
      }
      .tabViewStyle(.sidebarAdaptable)
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

    #if os(macOS)
      /// True when the window is too narrow for the bar's page names; it shows icons only.
      @State private var narrow = false
    #endif

    /// True on a page's first screen; opening a movie or show hides the Apple TV bar.
    private var atRoot: Bool { paths[page]?.isEmpty ?? true }

    var body: some View {
      bar.modifier(FollowsLinks(page: $page, homePath: $paths.path(.home)))
    }

    @ViewBuilder private var bar: some View {
      #if os(macOS)
        pages
          // Below this width the full bar no longer fits between the window buttons and the
          // edge, and macOS would fold it into an overflow menu.
          .onGeometryChange(for: Bool.self) {
            $0.size.width < 760
          } action: {
            narrow = $0
          }
          .toolbar {
            ToolbarItem(placement: .principal) {
              // A little below the window buttons' line, so the bar has room above it.
              TopBar(page: $page, iconsOnly: narrow).offset(y: 6)
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
  /// Command-1 to 4 open the library pages, Command-F Search and Command-comma Settings; on
  /// Apple TV, moving focus onto a tab opens its page.
  private struct TopBar: View {
    @Binding var page: Page
    /// Icons without names, for a narrow Mac window; hovering a tab shows its name.
    var iconsOnly = false
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
          ForEach(Page.allCases, id: \.self) { each in
            let chosen = each == page
            Button {
              withAnimation(.spring(duration: 0.35, bounce: 0.2)) { page = each }
            } label: {
              Group {
                if each.iconOnly || iconsOnly {
                  Image(systemName: each.symbol).accessibilityLabel(each.title)
                } else {
                  Label(each.title, systemImage: each.symbol).labelStyle(.titleAndIcon)
                }
              }
              // Inside the label, so the whole pill takes the click, not just the text.
              .padding(.horizontal, each.iconOnly || iconsOnly ? 10 : 14)
              .padding(.vertical, 6)
              .contentShape(.capsule)
            }
            #if os(tvOS)
              // Focus shows as the pill itself, not the system's lift.
              .buttonStyle(BarButton())
              .focused(focus, equals: each)
            #else
              .buttonStyle(.plain)
              .keyboardShortcut(each.shortcut, modifiers: .command)
              .help(each.title)
            #endif
            .font(.body.weight(.semibold))
            .foregroundStyle(chosen && lit ? Color.black : Color.white)
            .background {
              if chosen {
                Capsule().fill(.white.opacity(lit ? 1 : 0.2))
                  .matchedGeometryEffect(id: "pill", in: pill)
              }
            }
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
    LibraryPage(title: "Home", empty: store.isEmpty ? .library : nil) {
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
      if !store.continueWatching.isEmpty {
        Shelf(title: "Continue Watching", items: store.continueWatching) { item in
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
            PosterCell(
              seed: movie.id, title: movie.title, detail: movie.year.map(String.init),
              watchID: movie.id
            ).frame(
              width: Metrics.poster)
          }
          .artworkButton()
          .zoomSource(movie.id, in: zoom)
        }
      }
      if !store.shows.isEmpty {
        Shelf(title: "Shows", items: store.shows) { show in
          NavigationLink(value: show) {
            PosterCell(seed: show.id, title: show.title, detail: show.years).frame(
              width: Metrics.poster)
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
  @ViewBuilder var content: Content

  var body: some View {
    ScrollView {
      if let empty {
        // Inside the scroll view, filling the page, so pull to refresh still works.
        empty.containerRelativeFrame([.horizontal, .vertical])
      } else {
        content.padding(.bottom, Metrics.spacing * 2)
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
      title: section.rawValue, empty: store.isEmpty(section) ? EmptyState(section) : nil
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
              PosterCell(
                seed: movie.id, title: movie.title, detail: movie.year.map(String.init),
                watchID: movie.id)
            }
            .artworkButton()
            .gridFocus($focused, movie.id)
            .zoomSource(movie.id, in: zoom)
          }
        }
      case .shows:
        LazyVGrid(columns: posterColumns, spacing: Metrics.spacing) {
          ForEach(store.shows) { show in
            NavigationLink(value: show) {
              PosterCell(seed: show.id, title: show.title, detail: show.years)
            }
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
    let trimmed = query.trimmingCharacters(in: .whitespaces)
    let titles =
      (store.movies.filter { matches($0.title) }.map(Hit.movie)
      + store.shows.filter { matches($0.title) }.map(Hit.show))
      .sorted { $0.title.localizedStandardCompare($1.title) == .orderedAscending }
    let sets = store.sets.filter { matches($0.title) || matches($0.djLine) }
    ScrollView {
      VStack(alignment: .leading, spacing: Metrics.spacing * 1.5) {
        if !titles.isEmpty {
          LazyVGrid(
            columns: [
              GridItem(.adaptive(minimum: Metrics.poster * 0.84), spacing: Metrics.spacing)
            ],
            spacing: Metrics.spacing
          ) {
            ForEach(titles) { hit in
              NavigationLink(value: hit.destination) {
                PosterCell(seed: hit.id, title: hit.title, detail: hit.year, watchID: hit.watchID)
              }
              .artworkButton()
            }
          }
        }
        if !sets.isEmpty {
          LazyVGrid(
            columns: [
              GridItem(.adaptive(minimum: Metrics.wide * 0.75), spacing: Metrics.spacing)
            ],
            spacing: Metrics.spacing * 1.5
          ) {
            ForEach(sets) { set in
              NavigationLink(value: set) {
                WideCell(seed: set.id, title: set.djLine, detail: set.title, watchID: set.id)
              }
              .artworkButton()
            }
          }
        }
      }
      .padding(.horizontal, Metrics.gutter)
    }
    // Fills the page even with nothing in it, so the message below gets the full width.
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .blackPage()
    .overlay {
      if store.isEmpty {
        EmptyState.library
      } else if !trimmed.isEmpty && titles.isEmpty && sets.isEmpty {
        ContentUnavailableView.search(text: trimmed)
      }
    }
  }

  /// A movie or show in the poster grid; DJ sets follow as wide cards.
  private enum Hit: Identifiable {
    case movie(Movie)
    case show(Show)

    var id: String {
      switch self {
      case .movie(let m): m.id
      case .show(let s): s.id
      }
    }
    var title: String {
      switch self {
      case .movie(let m): m.title
      case .show(let s): s.title
      }
    }
    var year: String? {
      switch self {
      case .movie(let m): m.year.map(String.init)
      case .show(let s): s.years
      }
    }
    /// Only movies show watch progress on their poster, as on the Movies page.
    var watchID: String? { if case .movie(let m) = self { m.id } else { nil } }
    var destination: AnyHashable {
      switch self {
      case .movie(let m): m
      case .show(let s): s
      }
    }
  }

  /// An empty query matches nothing: the page waits for you to type.
  private func matches(_ text: String) -> Bool {
    let trimmed = query.trimmingCharacters(in: .whitespaces)
    return !trimmed.isEmpty && text.localizedCaseInsensitiveContains(trimmed)
  }
}
