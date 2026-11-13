import StoreKit
import SwiftUI

struct TipJarView: View {
  @Bindable var store: TipStore

  var body: some View {
    TipJarContent(
      rows: store.products.map {
        TipJarRow(id: $0.id, displayName: $0.displayName, displayPrice: $0.displayPrice)
      },
      loading: store.loading, purchasing: store.purchasing, message: store.message,
      celebration: store.celebrationID,
      retry: { Task { await store.load() } },
      purchase: { id in
        guard let product = store.products.first(where: { $0.id == id }) else { return }
        Task { await store.purchase(product) }
      }
    )
    .task {
      store.message = nil
      await store.load()
    }
  }
}
