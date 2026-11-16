// The chosen structure: a Home page, then a page per section, with side navigation
// on Mac, Apple TV and wide iPhone screens (a tab bar on narrow ones).
import SwiftUI

struct RootTabs: View {
    @Namespace private var zoom
    @State private var query = ""

    var body: some View {
        TabView {
            Tab("Home", systemImage: "house") {
                NavigationStack { HomeView(zoom: zoom).libraryDestinations(zoom) }
            }
            ForEach(LibrarySection.allCases) { section in
                Tab {
                    NavigationStack { SectionGrid(section: section, zoom: zoom).libraryDestinations(zoom) }
                } label: {
                    section.label
                }
            }
            Tab(role: .search) {
                NavigationStack {
                    SearchResults(query: query).navigationTitle("Search").libraryDestinations(zoom)
                        #if !os(iOS)
                            .searchable(text: $query, prompt: "Movies, shows and DJs")
                        #endif
                }
            }
        }
        .tabViewStyle(.sidebarAdaptable)
        #if os(iOS)
            // On iPhone the search tab turns into the search field, so the field belongs to the tab view.
            .searchable(text: $query, prompt: "Movies, shows and DJs")
            .tabBarMinimizeBehavior(.onScrollDown)
        #endif
    }
}

// MARK: - Home

struct HomeView: View {
    @Environment(Store.self) private var store
    let zoom: Namespace.ID

    var body: some View {
        ScrollView {
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
                    ContinueCard(item: first).padding(.horizontal, Metrics.gutter)
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
                if !store.movies.isEmpty { Shelf(title: "Movies") {
                    ForEach(store.movies) { movie in
                        NavigationLink(value: movie) {
                            PosterCell(seed: movie.id, title: movie.title, watchID: movie.id).frame(width: Metrics.poster)
                        }
                        .artworkButton()
                        .zoomSource(movie.id, in: zoom)
                    }
                } }
                if !store.shows.isEmpty { Shelf(title: "Shows") {
                    ForEach(store.shows) { show in
                        NavigationLink(value: show) {
                            PosterCell(seed: show.id, title: show.title).frame(width: Metrics.poster)
                        }
                        .artworkButton()
                        .zoomSource(show.id, in: zoom)
                    }
                } }
                if !store.sets.isEmpty { Shelf(title: "DJ Sets") {
                    ForEach(store.sets) { set in
                        NavigationLink(value: set) {
                            WideCell(seed: set.id, title: set.djLine, detail: set.title, watchID: set.id)
                                .frame(width: Metrics.wide)
                        }
                        .artworkButton()
                        .zoomSource(set.id, in: zoom)
                    }
                } }
            }
            .padding(.vertical, Metrics.spacing)
        }
        .overlay {
            if store.isEmpty {
                ContentUnavailableView(
                    "Nothing Here Yet", systemImage: "film.stack",
                    description: Text("Movies, shows and DJ sets appear here once they are added to the library."))
            }
        }
        .refreshable { await store.load() }
        .blackPage()
        #if !os(tvOS)
            .navigationTitle("Home")
        #endif
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
    }
}

/// The large card at the top of Home: the thing you were last watching.
private struct ContinueCard: View {
    @Environment(Store.self) private var store
    @Environment(\.horizontalSizeClass) private var sizeClass
    let item: ContinueItem

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
                systemImage: "play.fill")
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
                    stops: [.init(color: .clear, location: 0.35), .init(color: .black.opacity(0.95), location: 0.82)],
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
                Text("Continue Watching").font(.subheadline.weight(.semibold)).foregroundStyle(.secondary)
                text
                resume(fullWidth: false)
            }
            Spacer(minLength: 0)
        }
        .padding(40)
        .background { Artwork(seed: item.artID).blur(radius: 70).overlay(.black.opacity(0.5)) }
        .clipShape(.rect(cornerRadius: 28))
    }
}

// MARK: - Section pages

struct SectionGrid: View {
    @Environment(Store.self) private var store
    let section: LibrarySection
    let zoom: Namespace.ID

    var body: some View {
        ScrollView {
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
        .scrollClipDisabled()
        .blackPage()
        #if !os(tvOS)
            .navigationTitle(section.rawValue)
        #endif
    }

    private var posterColumns: [GridItem] {
        [GridItem(.adaptive(minimum: Metrics.poster * 0.84), spacing: Metrics.spacing)]
    }
}

// MARK: - Search

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
                            MediaRow(seed: movie.id, title: movie.title, detail: movie.year.map(String.init) ?? "")
                        }
                    }
                }
            }
            if !shows.isEmpty {
                Section("Shows") {
                    ForEach(shows) { show in
                        NavigationLink(value: show) { MediaRow(seed: show.id, title: show.title, detail: show.years ?? "") }
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
        .blackPage()
        .overlay {
            if movies.isEmpty && shows.isEmpty && sets.isEmpty {
                ContentUnavailableView.search(text: query)
            }
        }
    }

    private func matches(_ text: String) -> Bool {
        query.isEmpty || text.localizedCaseInsensitiveContains(query)
    }
}
