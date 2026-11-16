// Detail pages. One column on iPhone; artwork beside the text on Mac and Apple TV.
import SwiftUI

extension View {
  /// Registers every push destination. `zoom` is the namespace artwork zooms out of.
  func libraryDestinations(_ zoom: Namespace.ID) -> some View {
    self
      .navigationDestination(for: Movie.self) {
        MovieDetail(movie: $0).zoomDestination($0.id, in: zoom)
      }
      .navigationDestination(for: Show.self) {
        ShowDetail(show: $0).zoomDestination($0.id, in: zoom)
      }
      .navigationDestination(for: DJSet.self) {
        SetDetail(set: $0).zoomDestination($0.id, in: zoom)
      }
      .navigationDestination(for: DJ.self) { DJPage(dj: $0) }
  }
}

struct DetailScaffold<Content: View>: View {
  @Environment(\.horizontalSizeClass) private var sizeClass
  let seed: String
  let title: String
  let meta: String
  var badges: [String] = []
  /// True for 16:9 artwork (DJ sets); false for posters.
  var wideArt = false
  @ViewBuilder var content: Content

  var body: some View {
    Group {
      if sizeClass == .compact { phone } else { sideBySide }
    }
    .inlineTitle()
  }

  /// `showsTitle` is false over an iPhone poster, which already carries the title.
  private func header(showsTitle: Bool = true) -> some View {
    VStack(alignment: .leading, spacing: 8) {
      if showsTitle { Text(title).font(.largeTitle.bold()) }
      Text(meta).font(.subheadline).foregroundStyle(.secondary)
      if !badges.isEmpty {
        HStack(spacing: 6) {
          ForEach(badges, id: \.self) { badge in
            Text(badge)
              .font(.caption2.weight(.semibold))
              .padding(.horizontal, 7)
              .padding(.vertical, 3)
              .overlay(Capsule().strokeBorder(.white.opacity(0.4)))
          }
        }
      }
    }
  }

  private var phone: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 0) {
        if wideArt {
          Artwork(seed: seed, small: false).aspectRatio(16 / 9, contentMode: .fit)
          header().padding(.horizontal, 20).padding(.top, 20)
        } else {
          Artwork(seed: seed, alignment: .top, small: false)
            .frame(height: 540)
            .overlay {
              LinearGradient(
                stops: [.init(color: .clear, location: 0.45), .init(color: .black, location: 1)],
                startPoint: .top, endPoint: .bottom)
            }
            .overlay(alignment: .bottomLeading) {
              header(showsTitle: false).padding(.horizontal, 20).padding(.bottom, 4)
            }
        }
        VStack(alignment: .leading, spacing: 24) { content }.padding(20)
      }
    }
    .ignoresSafeArea(edges: wideArt ? [] : .top)
    .background(.black)
  }

  private var sideBySide: some View {
    ScrollView {
      HStack(alignment: .top, spacing: 48) {
        Artwork(seed: seed, small: false)
          .aspectRatio(wideArt ? 16 / 9 : 2 / 3, contentMode: .fit)
          .frame(width: wideArt ? Metrics.detailWide : Metrics.detailPoster)
          .clipShape(.rect(cornerRadius: 20))
          .shadow(radius: 30, y: 10)
        VStack(alignment: .leading, spacing: 28) {
          header()
          content
        }
        .frame(maxWidth: 760, alignment: .leading)
        Spacer(minLength: 0)
      }
      .padding(48)
    }
    .blackPage()
  }
}

/// The main action: Play, Resume or Play Again, with time left when part-way through.
struct PlayButton: View {
  @Environment(Store.self) private var store
  @Environment(\.horizontalSizeClass) private var sizeClass
  let id: String
  let minutes: Int
  var label: String?
  /// Shown beside Play on larger screens, where there is no toolbar menu.
  var watchedToggle = true
  let action: () -> Void

  var body: some View {
    let compact = sizeClass == .compact
    VStack(alignment: .leading, spacing: 12) {
      HStack(spacing: 14) {
        Button(action: action) {
          Label(label ?? defaultLabel, systemImage: "play.fill")
            .font(.headline)
            .contentTransition(.interpolate)
            .frame(maxWidth: compact ? .infinity : nil)
            .padding(.vertical, 6)
            .padding(.horizontal, compact ? 0 : 28)
        }
        .buttonStyle(.glassProminent)
        .tint(.white)
        .foregroundStyle(.black)

        if !compact && watchedToggle {
          Button {
            store.setWatched([id], !store.isWatched(id))
          } label: {
            Label(
              store.isWatched(id) ? "Watched" : "Mark as Watched",
              systemImage: store.isWatched(id) ? "checkmark.circle.fill" : "circle"
            )
            .padding(.vertical, 6)
          }
          .buttonStyle(.glass)
        }
      }

      if store.isInProgress(id) {
        HStack(spacing: 10) {
          WatchProgressBar(fraction: store.fraction(id)).frame(maxWidth: compact ? .infinity : 320)
          Text("\(runtime(store.minutesLeft(id, of: minutes))) left")
            .font(.footnote)
            .foregroundStyle(.secondary)
            .fixedSize()
        }
        .transition(.opacity)
      }
    }
    // Play, Resume and Play Again swap as progress changes; ease the label, bar and button width.
    .animation(.smooth(duration: 0.35), value: store.fraction(id))
  }

  private var defaultLabel: String {
    if store.isInProgress(id) { return "Resume" }
    return store.isWatched(id) ? "Play Again" : "Play"
  }
}

#if os(iOS)
  /// Toolbar menu to mark one or more items watched or unwatched.
  struct WatchedMenu: ToolbarContent {
    @Environment(Store.self) private var store
    let ids: [String]
    var noun = ""

    var body: some ToolbarContent {
      ToolbarItem(placement: .topBarTrailing) {
        Menu {
          Button("Mark \(noun)as Watched", systemImage: "checkmark.circle") {
            store.setWatched(ids, true)
          }
          Button("Mark \(noun)as Unwatched", systemImage: "circle") { store.setWatched(ids, false) }
        } label: {
          Image(systemName: "ellipsis")
        }
      }
    }
  }
#endif

extension View {
  @ViewBuilder func watchedMenu(_ ids: [String], noun: String = "") -> some View {
    #if os(iOS)
      self.toolbar { WatchedMenu(ids: ids, noun: noun) }
    #else
      self
    #endif
  }
}

struct MovieDetail: View {
  @Environment(Store.self) private var store
  let movie: Movie

  var body: some View {
    DetailScaffold(
      seed: movie.id, title: movie.title, meta: movie.meta,
      badges: movie.badges
    ) {
      PlayButton(id: movie.id, minutes: movie.minutes) { store.play(movie) }
    }
    .watchedMenu([movie.id])
  }
}

struct ShowDetail: View {
  @Environment(Store.self) private var store
  let show: Show
  @State private var season: Int?

  var body: some View {
    let next = store.nextEpisode(for: show)
    let shown = season ?? next.season
    DetailScaffold(
      seed: show.id, title: show.title,
      meta: show.meta
    ) {
      VStack(alignment: .leading, spacing: 8) {
        PlayButton(
          id: next.id, minutes: next.minutes,
          label: "\(store.hasStarted(show) ? "Continue" : "Start") \(next.code)",
          watchedToggle: false
        ) {
          store.play(next, in: show)
        }
        Text(next.title).font(.subheadline).foregroundStyle(.secondary)
      }

      VStack(alignment: .leading, spacing: 4) {
        Menu {
          ForEach(show.seasons, id: \.self) { number in
            Button("Season \(number)") { season = number }
          }
        } label: {
          HStack(spacing: 6) {
            Text("Season \(shown)").font(.title3.bold())
            Image(systemName: "chevron.down").font(.footnote.weight(.bold))
          }
        }
        #if !os(tvOS)
          .buttonStyle(.plain)
        #endif
        .padding(.bottom, 8)

        ForEach(show.episodes.filter { $0.season == shown }) { episode in
          EpisodeRow(show: show, episode: episode)
          Divider()
        }
      }
    }
    .watchedMenu(show.episodes.map(\.id), noun: "All ")
  }
}

private struct EpisodeRow: View {
  @Environment(Store.self) private var store
  let show: Show
  let episode: Episode

  var body: some View {
    Button {
      store.play(episode, in: show)
    } label: {
      HStack(alignment: .firstTextBaseline, spacing: 14) {
        Text("\(episode.number)")
          .font(.body.monospacedDigit())
          .foregroundStyle(.secondary)
          .frame(minWidth: 28, alignment: .leading)
        VStack(alignment: .leading, spacing: 6) {
          Text(episode.title).font(.body)
          if store.isInProgress(episode.id) {
            WatchProgressBar(fraction: store.fraction(episode.id)).frame(width: 120)
          }
        }
        // Takes the row's spare width itself; beside a Spacer the fixed-width bar made the title wrap.
        .frame(maxWidth: .infinity, alignment: .leading)
        Text(runtime(episode.minutes)).font(.subheadline).foregroundStyle(.secondary)
        Image(systemName: "checkmark")
          .font(.footnote.weight(.bold))
          .opacity(store.isWatched(episode.id) ? 1 : 0)
      }
      .padding(.vertical, 12)
      .contentShape(.rect)
    }
    #if !os(tvOS)
      .buttonStyle(.plain)
    #endif
    .contextMenu {
      Button("Mark as Watched", systemImage: "checkmark.circle") {
        store.setWatched([episode.id], true)
      }
      Button("Mark as Unwatched", systemImage: "circle") { store.setWatched([episode.id], false) }
    }
  }
}

struct SetDetail: View {
  @Environment(Store.self) private var store
  let set: DJSet

  var body: some View {
    DetailScaffold(
      seed: set.id, title: set.djLine,
      meta: [set.title, set.year, runtime(set.minutes)].compactMap { $0 }.joined(separator: " · "),
      wideArt: true
    ) {
      PlayButton(id: set.id, minutes: set.minutes) { store.play(set) }

      VStack(alignment: .leading, spacing: 4) {
        Text(set.djs.count > 1 ? "More from these DJs" : "More from this DJ").font(.title3.bold())
          .padding(.bottom, 8)
        ForEach(set.djs, id: \.self) { name in
          NavigationLink(value: DJ(name: name)) {
            HStack {
              Text(name).font(.body)
              Spacer()
              Text("\(store.sets(for: DJ(name: name)).count)").foregroundStyle(.secondary)
              Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(
                .tertiary)
            }
            .padding(.vertical, 12)
            .contentShape(.rect)
          }
          #if !os(tvOS)
            .buttonStyle(.plain)
          #endif
          Divider()
        }
      }
    }
    .watchedMenu([set.id])
  }
}

struct DJPage: View {
  @Environment(Store.self) private var store
  let dj: DJ

  var body: some View {
    List(store.sets(for: dj)) { set in
      NavigationLink(value: set) {
        MediaRow(
          seed: set.id, title: set.title,
          detail: [set.djs.count > 1 ? set.djLine : nil, set.year, runtime(set.minutes)]
            .compactMap { $0 }.joined(separator: " · "),
          wide: true)
      }
    }
    .listStyle(.plain)
    .blackPage()
    .navigationTitle(dj.name)
  }
}
