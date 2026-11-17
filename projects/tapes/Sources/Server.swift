// The Tapes server on the home network, through the client generated from `openapi.json`.
import Foundation
import OpenAPIRuntime
import OpenAPIURLSession
import TapesAPI

struct Server: Sendable {
  /// The Mac mini on the home network. Launch with `-server http://host:port` to use another.
  static let defaultURL = URL(string: "http://homelab-mac-mini.local:4300")!

  let baseURL: URL
  private let client: Client

  init(baseURL: URL? = nil) {
    let override = UserDefaults.standard.string(forKey: "server").flatMap(URL.init(string:))
    let url = baseURL ?? override ?? Self.defaultURL
    let configuration = URLSessionConfiguration.default
    configuration.timeoutIntervalForRequest = 15
    self.baseURL = url
    self.client = Client(
      serverURL: url,
      transport: URLSessionTransport(
        configuration: .init(session: URLSession(configuration: configuration))))
  }

  func mediaURL(_ id: String) -> URL { baseURL.appending(path: "media/\(id)") }

  func artURL(_ id: String, small: Bool) -> URL {
    let url = baseURL.appending(path: "art/\(id)")
    return small ? url.appending(queryItems: [URLQueryItem(name: "size", value: "small")]) : url
  }

  func library() async throws -> LibrarySnapshot {
    switch try await client.getLibrary() {
    case .ok(let ok):
      return LibrarySnapshot(try ok.body.json)
    case .serviceUnavailable:
      throw LibraryUnreadable()
    case .undocumented(let status, _):
      throw ServerError("The Tapes server answered with error \(status).")
    }
  }

  func saveProgress(_ id: String, _ progress: WatchProgress) async throws {
    let body = Components.Schemas.Progress(seconds: progress.seconds, watched: progress.watched)
    switch try await client.putProgress(path: .init(id: id), body: .json(body)) {
    case .noContent: return
    case .badRequest: throw ServerError("The server rejected the saved position.")
    case .undocumented(let status, _):
      throw ServerError("Saving progress failed with error \(status).")
    }
  }
}

/// One plain sentence for why a request failed. The generated client wraps the network error in
/// a long description of the operation, the transport and every underlying error.
func failureReason(_ error: Error) -> String {
  if let client = error as? ClientError { return client.underlyingError.localizedDescription }
  return error.localizedDescription
}

/// The server is up but has not read the library on the NAS since it started.
struct LibraryUnreadable: Error {}

struct ServerError: LocalizedError {
  let message: String
  init(_ message: String) { self.message = message }
  var errorDescription: String? { message }
}

extension LibrarySnapshot {
  init(_ response: Components.Schemas.LibraryResponse) {
    var progress: [String: WatchProgress] = [:]
    func keep(_ id: String, _ saved: Components.Schemas.Progress?) {
      if let saved {
        progress[id] = WatchProgress(
          seconds: saved.seconds, watched: saved.watched, updatedAt: saved.updatedAt)
      }
    }
    movies = response.movies.map { movie in
      keep(movie.id, movie.progress)
      return Movie(
        id: movie.id, title: movie.title, year: movie.year.map(Int.init),
        seconds: movie.seconds ?? 0,
        badges: movie.badges, hasArt: movie.hasArt, bytes: movie.bytes ?? 0)
    }
    shows = response.shows.map { show in
      Show(
        id: show.id, title: show.title, years: show.years, hasArt: show.hasArt,
        episodes: show.episodes.map { episode in
          keep(episode.id, episode.progress)
          return Episode(
            id: episode.id, season: Int(episode.season), number: Int(episode.number),
            title: episode.title,
            seconds: episode.seconds ?? 0, bytes: episode.bytes ?? 0)
        })
    }
    sets = response.sets.map { set in
      keep(set.id, set.progress)
      return DJSet(
        id: set.id, djs: set.djs, title: set.title, date: set.date, seconds: set.seconds ?? 0,
        hasArt: set.hasArt, bytes: set.bytes ?? 0)
    }
    available = response.available
    self.progress = progress
  }
}
