import StoreKit
import SwiftUI

struct TipJarView: View {
  @Bindable var store: TipStore

  var body: some View {
    Form {
      Section {
        if store.loading && store.products.isEmpty {
          ProgressView()
        } else if store.products.isEmpty {
          ContentUnavailableView {
            Label(
              String(localized: "tips.unavailable", defaultValue: "Tips unavailable"),
              systemImage: "cup.and.saucer")
          } actions: {
            Button(String(localized: "action.retry", defaultValue: "Retry")) {
              Task { await store.load() }
            }
          }
        } else {
          ForEach(store.products, id: \.id) { product in
            Button {
              Task { await store.purchase(product) }
            } label: {
              HStack {
                Text(product.displayName)
                Spacer()
                if store.purchasing == product.id {
                  ProgressView()
                } else {
                  Text(product.displayPrice)
                }
              }
            }
            .disabled(store.purchasing != nil)
          }
        }
        if let message = store.message { Text(message) }
      } footer: {
        Text(String(localized: "tips.footer", defaultValue: "Always free. Tips are optional."))
      }
    }
    .navigationTitle(String(localized: "tips.title", defaultValue: "Tip jar"))
    .task {
      store.message = nil
      await store.load()
    }
  }
}
