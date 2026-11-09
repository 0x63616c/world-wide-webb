import XCTest
@testable import RDesign

final class RDesignTests: XCTestCase {
    func testSpacingScaleOnlyGrows() {
        let scale = [RSpacing.xxs, RSpacing.xs, RSpacing.s, RSpacing.m, RSpacing.l, RSpacing.xl, RSpacing.xxl]
        XCTAssertEqual(scale, scale.sorted())
        XCTAssertEqual(Set(scale).count, scale.count)
    }

    #if canImport(SwiftUI)
    @MainActor func testTipJarKeepsTheAppsOrderAndStartsLoading() {
        let jar = RTipJar(tips: [
            .init(id: "small", productID: "com.example.tip.small", fallbackName: "Coffee", symbol: "cup.and.saucer.fill"),
            .init(id: "large", productID: "com.example.tip.large", fallbackName: "Gift", symbol: "gift.fill")
        ])
        XCTAssertEqual(jar.phase, .loading)
        XCTAssertEqual(jar.tips.map(\.id), ["small", "large"])
        XCTAssertNil(jar.completed)
        XCTAssertTrue(jar.products.isEmpty)
    }

    func testConfettiIsDeterministic() {
        let first = ConfettiPiece.burst(count: 20).map(\.speed)
        XCTAssertEqual(first, ConfettiPiece.burst(count: 20).map(\.speed))
        XCTAssertTrue(first.allSatisfy { (1350...2250).contains($0) })
    }
    #endif
}
