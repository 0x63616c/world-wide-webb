import SwiftUI

struct TipJarRow: Identifiable, Sendable {
  let id: String
  let displayName: String
  let displayPrice: String
}

/// Native rendering shared by the real StoreKit adapter and isolated reviewer capture.
struct TipJarContent: View {
  let rows: [TipJarRow]
  let loading: Bool
  let purchasing: String?
  let message: String?
  let retry: () -> Void
  let purchase: (String) -> Void

  var body: some View {
    Form {
      Section {
        if loading && rows.isEmpty {
          ProgressView()
        } else if rows.isEmpty {
          ContentUnavailableView {
            Label(
              String(localized: "tips.unavailable", defaultValue: "Tips unavailable"),
              systemImage: "cup.and.saucer")
          } actions: {
            Button(String(localized: "action.retry", defaultValue: "Retry")) {
              retry()
            }
          }
        } else {
          ForEach(rows, id: \.id) { product in
            Button {
              purchase(product.id)
            } label: {
              HStack {
                Text(product.displayName)
                Spacer()
                if purchasing == product.id {
                  ProgressView()
                } else {
                  Text(product.displayPrice)
                }
              }
            }
            .disabled(purchasing != nil)
          }
        }
        if let message = message { Text(message) }
      } footer: {
        Text(String(localized: "tips.footer", defaultValue: "Always free. Tips are optional."))
      }
    }
    .navigationTitle(String(localized: "tips.title", defaultValue: "Tip jar"))
  }
}
