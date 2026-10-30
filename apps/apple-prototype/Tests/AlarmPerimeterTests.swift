import XCTest
@testable import WorldWideWebb

final class AlarmPerimeterTests: XCTestCase {
    private let path = AlarmPerimeter(size: CGSize(width: 1320, height: 976))

    func testConcentricCornersAndClockwiseCardinalPoints() {
        XCTAssertEqual(path.radius + AlarmPerimeter.edgeInset, AlarmPerimeter.displayCornerRadius)
        let expected = [CGPoint(x: 660, y: 0), CGPoint(x: 1320, y: 488),
                        CGPoint(x: 660, y: 976), CGPoint(x: 0, y: 488), CGPoint(x: 660, y: 0)]
        for (index, point) in expected.enumerated() {
            let sample = path.sample(at: path.length * Double(index) / 4)
            XCTAssertEqual(sample.point.x, point.x, accuracy: 0.00001)
            XCTAssertEqual(sample.point.y, point.y, accuracy: 0.00001)
        }
    }

    func testArcLengthAndNormalsThroughEveryCorner() {
        // Sub-point increments must travel the same distance at straight edges,
        // joins and corners; catches angular sampling that bunches corner ticks.
        let step: CGFloat = 0.25
        for distance in stride(from: CGFloat.zero, to: path.length, by: step) {
            let a = path.sample(at: distance)
            let b = path.sample(at: distance + step)
            let dx = b.point.x - a.point.x, dy = b.point.y - a.point.y
            XCTAssertEqual(hypot(dx, dy), step, accuracy: 0.00001)
            XCTAssertEqual(hypot(a.normal.dx, a.normal.dy), 1, accuracy: 0.00001)
            XCTAssertEqual(dx * a.normal.dx + dy * a.normal.dy, 0, accuracy: 0.002)
        }
    }
}
