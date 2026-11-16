// The library as the app sees it, loaded from the Tapes server, with shared watch progress.
import Observation
import SwiftUI

struct Movie: Identifiable, Hashable {
  let id: String
  let title: String
  let year: Int?
  let seconds: Double
  let badges: [String]
  let hasArt: Bool
  var minutes: Int { minutesOf(seconds) }
  var meta: String {
    [year.map(String.init), runtime(minutes)].compactMap { $0 }.joined(separator: " · ")
  }
}

struct Episode: Identifiable, Hashable {
  let id: String
  let season: Int
  let number: Int
  let title: String
  let seconds: Double
  var minutes: Int { minutesOf(seconds) }
  var code: String { "S\(season) · E\(number)" }
}

struct Show: Identifiable, Hashable {
  let id: String
  let title: String
  let years: String?
  let hasArt: Bool
  let episodes: [Episode]
  var seasons: [Int] { Array(Set(episodes.map(\.season))).sorted() }
  var meta: String {
    let count = seasons.count == 1 ? "1 season" : "\(seasons.count) seasons"
    return [years, count].compactMap { $0 }.joined(separator: " · ")
  }
}

struct DJSet: Identifiable, Hashable {
  let id: String
  let djs: [String]
  let title: String
  /// YYYY-MM-DD when known.
  let date: String?
  let seconds: Double
  let hasArt: Bool
  var minutes: Int { minutesOf(seconds) }
  var year: String? { date.map { String($0.prefix(4)) } }
  var djLine: String { djs.joined(separator: " b2b ") }
}

struct DJ: Identifiable, Hashable {
  let name: String
  var id: String { name }
}

struct WatchProgress: Hashable {
  var seconds: Double
  var watched: Bool
  var updatedAt: String?
}

enum LibrarySection: String, CaseIterable, Identifiable, Hashable {
  case movies = "Movies"
  case shows = "Shows"
  case sets = "DJ Sets"
  var id: String { rawValue }

  @ViewBuilder var label: some View {
    switch self {
    case .movies: Label(rawValue, systemImage: "film")
    case .shows: Label(rawValue, systemImage: "tv")
    case .sets: Label(rawValue, systemImage: "opticaldisc")
    }
  }
}

struct Playable: Identifiable, Hashable {
  let id: String
  let title: String
  let subtitle: String
}

enum ContinueItem: Identifiable, Hashable {
  case movie(Movie)
  case episode(Show, Episode)
  case set(DJSet)

  var id: String {
    switch self {
    case .movie(let movie): movie.id
    case .episode(_, let episode): episode.id
    case .set(let set): set.id
    }
  }
  /// The item whose artwork represents this one (a show for its episodes).
  var artID: String {
    switch self {
    case .movie(let movie): movie.id
    case .episode(let show, _): show.id
    case .set(let set): set.id
    }
  }
  var title: String {
    switch self {
    case .movie(let movie): movie.title
    case .episode(let show, _): show.title
    case .set(let set): set.djLine
    }
  }
  var detail: String {
    switch self {
    case .movie(let movie): movie.year.map(String.init) ?? ""
    case .episode(_, let episode): "\(episode.code) · \(episode.title)"
    case .set(let set): set.title
    }
  }
  var minutes: Int {
    switch self {
    case .movie(let movie): movie.minutes
    case .episode(_, let episode): episode.minutes
    case .set(let set): set.minutes
    }
  }
}

func minutesOf(_ seconds: Double) -> Int { max(1, Int((seconds / 60).rounded())) }

func runtime(_ minutes: Int) -> String {
  minutes >= 60 ? "\(minutes / 60)h \(minutes % 60)m" : "\(minutes)m"
}

/// What the server returned, already in app models.
struct LibrarySnapshot {
  var available = true
  var movies: [Movie] = []
  var shows: [Show] = []
  var sets: [DJSet] = []
  var progress: [String: WatchProgress] = [:]
}

@Observable
final class Store {
  enum Phase: Equatable {
    case loading
    case ready
    case failed(String)
  }

  let server: Server
  private(set) var phase = Phase.loading
  /// False when the server could not read the NAS on its last scan; lists are its last good copy.
  private(set) var available = true
  private(set) var movies: [Movie] = []
  private(set) var shows: [Show] = []
  private(set) var sets: [DJSet] = []
  private(set) var progress: [String: WatchProgress] = [:]
  /// Running time of every playable item, for turning positions into fractions.
  private var durations: [String: Double] = [:]
  var nowPlaying: Playable?

  init(server: Server = Server()) {
    self.server = server
  }

  /// Loads the library. Keeps what is on screen if a later refresh fails.
  func load() async {
    do {
      apply(try await server.library())
      phase = .ready
    } catch {
      if phase != .ready { phase = .failed(error.localizedDescription) }
    }
  }

  func retry() async {
    phase = .loading
    await load()
  }

  func apply(_ snapshot: LibrarySnapshot) {
    available = snapshot.available
    movies = snapshot.movies
    shows = snapshot.shows
    sets = snapshot.sets
    progress = snapshot.progress
    var durations: [String: Double] = [:]
    for movie in movies { durations[movie.id] = movie.seconds }
    for episode in shows.flatMap(\.episodes) { durations[episode.id] = episode.seconds }
    for set in sets { durations[set.id] = set.seconds }
    self.durations = durations
  }

  var isEmpty: Bool { movies.isEmpty && shows.isEmpty && sets.isEmpty }

  func position(_ id: String) -> Double { progress[id]?.seconds ?? 0 }

  func fraction(_ id: String) -> Double {
    guard let saved = progress[id] else { return 0 }
    if saved.watched && saved.seconds == 0 { return 1 }
    guard let duration = durations[id], duration > 0 else { return 0 }
    return min(1, saved.seconds / duration)
  }

  func isWatched(_ id: String) -> Bool { progress[id]?.watched ?? false }
  func isInProgress(_ id: String) -> Bool {
    let f = fraction(id)
    return !isWatched(id) && f > 0.02 && f < 0.95
  }
  func minutesLeft(_ id: String, of minutes: Int) -> Int {
    max(1, Int((Double(minutes) * (1 - fraction(id))).rounded()))
  }

  func setWatched(_ ids: [String], _ watched: Bool) {
    for id in ids { save(id, WatchProgress(seconds: 0, watched: watched)) }
  }

  /// Records where playback stopped. Near the end counts as watched and starts over next time.
  func record(_ id: String, seconds: Double, duration: Double) {
    guard seconds.isFinite, seconds >= 0 else { return }
    let total = duration.isFinite && duration > 0 ? duration : (durations[id] ?? 0)
    if total > 0 && seconds / total >= 0.95 {
      save(id, WatchProgress(seconds: 0, watched: true))
    } else if seconds > 5 {
      save(id, WatchProgress(seconds: seconds, watched: false))
    }
  }

  private func save(_ id: String, _ value: WatchProgress) {
    var value = value
    value.updatedAt = ISO8601DateFormatter().string(from: .now)
    progress[id] = value
    let server = server
    Task {
      do { try await server.saveProgress(id, value) } catch {
        print("Saving progress for \(id) failed: \(error)")
      }
    }
  }

  /// The episode to offer next: the one in progress, else the one after the last watched.
  func nextEpisode(for show: Show) -> Episode {
    if let current = show.episodes.first(where: { isInProgress($0.id) }) { return current }
    if let last = show.episodes.lastIndex(where: { isWatched($0.id) }),
      last + 1 < show.episodes.count
    {
      return show.episodes[last + 1]
    }
    return show.episodes.first(where: { !isWatched($0.id) }) ?? show.episodes[0]
  }

  func hasStarted(_ show: Show) -> Bool {
    show.episodes.contains {
      progress[$0.id] != nil && (isWatched($0.id) || fraction($0.id) > 0.02)
    }
  }

  private func lastTouched(_ show: Show) -> String {
    show.episodes.compactMap { progress[$0.id]?.updatedAt }.max() ?? ""
  }

  func sets(for dj: DJ) -> [DJSet] {
    sets.filter { $0.djs.contains(dj.name) }.sorted { ($0.date ?? "") > ($1.date ?? "") }
  }

  /// Things part-way through, most recently watched first. A show stays until its last episode.
  var continueWatching: [ContinueItem] {
    var items: [(String, ContinueItem)] = []
    for show in shows where hasStarted(show) {
      let next = nextEpisode(for: show)
      if isWatched(next.id) { continue }
      items.append((lastTouched(show), .episode(show, next)))
    }
    for movie in movies where isInProgress(movie.id) {
      items.append((progress[movie.id]?.updatedAt ?? "", .movie(movie)))
    }
    for set in sets where isInProgress(set.id) {
      items.append((progress[set.id]?.updatedAt ?? "", .set(set)))
    }
    return items.sorted { $0.0 > $1.0 }.map(\.1)
  }

  func play(_ movie: Movie) {
    nowPlaying = Playable(
      id: movie.id, title: movie.title, subtitle: movie.year.map(String.init) ?? "")
  }

  func play(_ episode: Episode, in show: Show) {
    nowPlaying = Playable(
      id: episode.id, title: episode.title, subtitle: "\(show.title) · \(episode.code)")
  }

  func play(_ set: DJSet) {
    nowPlaying = Playable(id: set.id, title: set.djLine, subtitle: set.title)
  }

  func play(_ item: ContinueItem) {
    switch item {
    case .movie(let movie): play(movie)
    case .episode(let show, let episode): play(episode, in: show)
    case .set(let set): play(set)
    }
  }
}
