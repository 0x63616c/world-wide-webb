import Foundation
import Observation
import StoreKit

@MainActor @Observable final class TipStore {
  static let shared = TipStore()
  let productIDs: [String]
  private(set) var products: [Product] = []
  private(set) var loading = false
  private(set) var purchasing: String?
  var message: String?
  private var listener: Task<Void, Never>?

  init(bundleID: String = Bundle.main.bundleIdentifier ?? "app.getfolding.Folding") {
    productIDs = ["small", "medium", "large"].map { "\(bundleID).tip.\($0)" }
  }

  func start() {
    guard listener == nil else { return }
    let ids = Set(productIDs)
    listener = Task {
      for await result in Transaction.unfinished {
        if case .verified(let transaction) = result,
          ids.contains(transaction.productID), transaction.productType == .consumable
        {
          await transaction.finish()
        }
      }
      for await result in Transaction.updates {
        if Task.isCancelled { return }
        if case .verified(let transaction) = result,
          ids.contains(transaction.productID), transaction.productType == .consumable
        {
          // Tips grant no entitlement or competition benefit.
          await transaction.finish()
        }
      }
    }
  }

  func load() async {
    guard !loading else { return }
    start()
    loading = true
    defer { loading = false }
    do {
      let available = try await Product.products(for: productIDs)
      products = productIDs.compactMap { id in
        available.first { $0.id == id && $0.type == .consumable }
      }
    } catch {
      message = String(
        localized: "error.tryAgain", defaultValue: "Something went wrong. Try again.")
    }
  }

  func purchase(_ product: Product) async {
    guard purchasing == nil, productIDs.contains(product.id), product.type == .consumable else {
      return
    }
    purchasing = product.id
    message = nil
    defer { purchasing = nil }
    do {
      switch try await product.purchase() {
      case .success(.verified(let transaction)):
        guard productIDs.contains(transaction.productID), transaction.productType == .consumable
        else { return }
        await transaction.finish()
        message = String(localized: "tips.thanks", defaultValue: "Thank you!")
      case .success(.unverified):
        message = String(
          localized: "error.tryAgain", defaultValue: "Something went wrong. Try again.")
      case .pending:
        message = String(localized: "tips.pending", defaultValue: "Awaiting approval")
      case .userCancelled:
        break
      @unknown default:
        break
      }
    } catch {
      message = String(
        localized: "error.tryAgain", defaultValue: "Something went wrong. Try again.")
    }
  }
}
