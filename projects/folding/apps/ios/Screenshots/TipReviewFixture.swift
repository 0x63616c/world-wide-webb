import Foundation

/// Reviewer-only values read from the same versioned product source as ASC automation.
/// This file is excluded from the distributable app and never creates StoreKit objects.
enum TipReviewFixture {
  private struct Configuration: Decodable {
    let currency: String
    let baseTerritory: String
    let products: [Product]
    enum CodingKeys: String, CodingKey {
      case currency, products
      case baseTerritory = "base_territory"
    }
  }
  private struct Product: Decodable {
    let id: String
    let price: String
    let localizations: [String: Localization]
    enum CodingKeys: String, CodingKey {
      case id = "product_id"
      case price = "usd_price"
      case localizations
    }
  }
  private struct Localization: Decodable { let name: String }

  static func load() throws -> [TipJarRow] {
    guard let url = Bundle.main.url(forResource: "tip-products", withExtension: "json") else {
      throw ScreenshotFixture.Failure.invalidArguments
    }
    let source = try JSONDecoder().decode(Configuration.self, from: Data(contentsOf: url))
    guard source.currency == "USD", source.baseTerritory == "USA", source.products.count == 3,
      Set(source.products.map(\.id)).count == 3
    else { throw ScreenshotFixture.Failure.invalidArguments }
    let formatter = NumberFormatter()
    formatter.locale = Locale(identifier: "en_US")
    formatter.numberStyle = .currency
    formatter.currencyCode = source.currency
    return try source.products.map { product in
      guard let name = product.localizations["en-US"]?.name,
        let amount = Decimal(string: product.price, locale: Locale(identifier: "en_US_POSIX")),
        amount > 0, let price = formatter.string(from: NSDecimalNumber(decimal: amount))
      else { throw ScreenshotFixture.Failure.invalidArguments }
      return TipJarRow(id: product.id, displayName: name, displayPrice: price)
    }
  }
}
