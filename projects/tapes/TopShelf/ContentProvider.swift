// Tapes on the Apple TV Top Shelf: what you're part-way through, or today's pick when nothing is.
// Selecting an item opens its page in Tapes; Play starts it.
import TVServices

final class ContentProvider: TVTopShelfContentProvider {
  nonisolated(nonsending) override func loadTopShelfContent() async -> (any TVTopShelfContent)? {
    await Self.content()
  }

  nonisolated(nonsending) private static func content() async -> TVTopShelfSectionedContent? {
    let store = Store()
    await store.load()
    guard store.phase == .ready else { return nil }
    let continuing = store.continueWatching
    let (title, items) =
      continuing.isEmpty
      ? ("From the Library", store.featured().map { [$0] } ?? [])
      : ("Continue Watching", Array(continuing.prefix(10)))
    guard !items.isEmpty else { return nil }
    let section = TVTopShelfItemCollection(items: items.map { item(for: $0, in: store) })
    section.title = title
    return TVTopShelfSectionedContent(sections: [section])
  }

  private static func item(for item: ContinueItem, in store: Store) -> TVTopShelfSectionedItem {
    let shelf = TVTopShelfSectionedItem(identifier: item.id)
    shelf.title = item.title
    shelf.imageShape = .hdtv
    if item.hasArt {
      shelf.setImageURL(
        store.server.artURL(item.artID, small: false), for: [.screenScale1x, .screenScale2x])
    }
    let fraction = store.fraction(item.id)
    if fraction > 0 { shelf.playbackProgress = fraction }
    shelf.displayAction = TVTopShelfAction(url: DeepLink.open(item.id).url)
    shelf.playAction = TVTopShelfAction(url: DeepLink.play(item.id).url)
    return shelf
  }
}
