import XCTest
@testable import WorldWideWebb

final class AlarmPerimeterTests: XCTestCase {
    private let path = AlarmPerimeter(size: CGSize(width: 1320, height: 976))

    func testConcentricCornersAndClockwiseCardinalPoints() {
        XCTAssertEqual(path.radius + AlarmPerimeter.edgeInset, AlarmPerimeter.faceCornerRadius)
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

    func testTickAnglesBeginOnStraightEdgesWithTightCorners() {
        for radius in [CGFloat(18), 32] {
            let path = AlarmPerimeter(size: CGSize(width: 1336, height: 994), cornerRadius: radius)
            let distance = path.size.width / 2 - radius - 30
            let sample = path.sample(at: distance)
            let tilted = path.tickNormal(at: distance, turningRadius: 100)
            // This is the user's key case: the first angled ticks stay flush
            // with the top, rather than retreating along a generous corner arc.
            XCTAssertEqual(sample.point.y, 0, accuracy: 0.00001)
            XCTAssertEqual(sample.normal.dx, 0, accuracy: 0.00001)
            XCTAssertGreaterThan(tilted.dx, 0)
            XCTAssertLessThan(tilted.dy, 0)
            XCTAssertEqual(hypot(tilted.dx, tilted.dy), 1, accuracy: 0.00001)
        }
    }

    func testIndependentTickDirectionsStayContinuousAroundAllFourCorners() {
        let path = AlarmPerimeter(size: CGSize(width: 1336, height: 994), cornerRadius: 32)
        for distance in stride(from: CGFloat.zero, to: path.length, by: 0.5) {
            let a = path.tickNormal(at: distance, turningRadius: 100)
            let b = path.tickNormal(at: distance + 0.5, turningRadius: 100)
            XCTAssertEqual(hypot(a.dx, a.dy), 1, accuracy: 0.00001)
            XCTAssertLessThan(hypot(a.dx - b.dx, a.dy - b.dy), 0.01)
        }
    }

    func testDiagonalCornerTicksAndTheirNeighborsAreExactlyAligned() {
        let path = AlarmPerimeter(size: CGSize(width: 1336, height: 994), cornerRadius: 32)
        let distances = path.tickDistances(count: 120, alignCorners: true)
        XCTAssertEqual(distances.count, 120)
        XCTAssertEqual(distances.first, 0)
        for (a, b) in zip(distances, distances.dropFirst()) { XCTAssertLessThan(a, b) }
        let arc = CGFloat.pi * path.radius / 2
        let horizontal = path.size.width - 2 * path.radius
        let vertical = path.size.height - 2 * path.radius
        let first = (horizontal + arc) / 2
        let corners = [first, first + vertical + arc, first + vertical + horizontal + 2 * arc,
            first + 2 * vertical + horizontal + 3 * arc]
        for (corner, center) in corners.enumerated() {
            let index = distances.indices.min { abs(distances[$0] - center) < abs(distances[$1] - center) }!
            XCTAssertEqual(distances[index], center, accuracy: 0.00001)
            let normal = path.tickNormal(at: center, turningRadius: 100)
            XCTAssertEqual(abs(normal.dx), sqrt(0.5), accuracy: 0.00001)
            XCTAssertEqual(abs(normal.dy), sqrt(0.5), accuracy: 0.00001)
            for neighbor in 1...2 {
                XCTAssertEqual(center - distances[index - neighbor], distances[index + neighbor] - center, accuracy: 0.00001)
            }
            let sample = path.sample(at: center)
            let expectedX = corner < 2 ? path.size.width - path.radius + path.radius / sqrt(2) : path.radius - path.radius / sqrt(2)
            let expectedY = corner == 0 || corner == 3 ? path.radius - path.radius / sqrt(2) : path.size.height - path.radius + path.radius / sqrt(2)
            XCTAssertEqual(sample.point.x, expectedX, accuracy: 0.00001)
            XCTAssertEqual(sample.point.y, expectedY, accuracy: 0.00001)
        }
    }
}
