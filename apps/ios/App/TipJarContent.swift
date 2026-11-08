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
  var celebration: UUID? = nil
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @State private var celebrationStart: Date?
  let retry: () -> Void
  let purchase: (String) -> Void

  var body: some View {
    Form {
      Section {
        VStack(spacing: 12) {
          Image(systemName: "cup.and.saucer.fill").font(.largeTitle)
        }
        .frame(maxWidth: .infinity).padding(.vertical, 16)
      }
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
      }
    }
    .fontDesign(.rounded)
    .overlay {
      if let start = celebrationStart, !reduceMotion {
        TimelineView(.animation(minimumInterval: 1.0 / 30)) { context in
          Canvas { drawing, size in
            let elapsed = CGFloat(max(0, context.date.timeIntervalSince(start)))
            for index in 0..<36 {
              let direction = CGFloat(index % 13) / 12 - 0.5
              let x = size.width / 2 + direction * size.width * elapsed
              let y = -20 + elapsed * (140 + CGFloat(index % 7) * 35) + 90 * elapsed * elapsed
              let rect = CGRect(x: x, y: y, width: CGFloat(5 + index % 3), height: 9)
              drawing.fill(
                Path(roundedRect: rect, cornerRadius: 2),
                with: .color(index.isMultiple(of: 2) ? .primary : .secondary))
            }
          }
        }
        .allowsHitTesting(false).accessibilityHidden(true)
      }
    }
    .onChange(of: celebration) { _, value in
      guard value != nil, !reduceMotion else { return }
      celebrationStart = .now
    }
    .task(id: celebrationStart) {
      guard celebrationStart != nil else { return }
      do {
        try await Task.sleep(for: .seconds(2.5))
        celebrationStart = nil
      } catch {}
    }
    .navigationTitle(String(localized: "tips.title", defaultValue: "Tip jar"))
  }
}
