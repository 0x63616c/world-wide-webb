import XCTest

@testable import Panel

final class AlarmPerimeterTests: XCTestCase {
    private let path = AlarmPerimeter(size: CGSize(width: 1320, height: 976))

    func testConcentricCornersAndClockwiseCardinalPoints() {
        XCTAssertEqual(path.radius + AlarmPerimeter.edgeInset, AlarmPerimeter.faceCornerRadius)
        let expected = [
            CGPoint(x: 660, y: 0), CGPoint(x: 1320, y: 488),
            CGPoint(x: 660, y: 976), CGPoint(x: 0, y: 488), CGPoint(x: 660, y: 0),
        ]
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
            let dx = b.point.x - a.point.x
            let dy = b.point.y - a.point.y
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

    func testEachCornerFansTenTicksOnEachSide() {
        let path = AlarmPerimeter(size: CGSize(width: 1336, height: 994), cornerRadius: 12)
        let count = 120
        let fan = 10
        let distances = path.tickDistances(count: count, cornerFanTicks: fan)
        let spacing = path.length / CGFloat(count)
        let turningRadius = CGFloat(fan) * spacing * 4 / .pi
        XCTAssertEqual(distances.count, count)
        XCTAssertEqual(distances.first, 0)
        for (a, b) in zip(distances, distances.dropFirst()) { XCTAssertLessThan(a, b) }
        let arc = CGFloat.pi * path.radius / 2
        let across = path.size.width - 2 * path.radius + arc
        let down = path.size.height - 2 * path.radius + arc
        let first = across / 2
        let corners = [first, first + down, first + down + across, first + 2 * down + across]
        for (corner, center) in corners.enumerated() {
            let after = distances.firstIndex { $0 > center }!
            let angle = CGFloat(corner - 1) * .pi / 2
            let edge = CGVector(dx: cos(angle), dy: sin(angle))
            func tilt(_ index: Int) -> CGFloat {
                let normal = path.tickNormal(at: distances[index], turningRadius: turningRadius)
                return acos(min(1, max(-1, normal.dx * edge.dx + normal.dy * edge.dy)))
            }
            XCTAssertEqual(tilt(after - fan - 1), 0, accuracy: 0.00001)
            XCTAssertEqual(tilt(after + fan), .pi / 2, accuracy: 0.00001)
            for index in (after - fan)..<after {
                XCTAssertGreaterThan(tilt(index), tilt(index - 1))
            }
            for offset in 0..<fan {
                XCTAssertEqual(
                    center - distances[after - 1 - offset], (CGFloat(offset) + 0.5) * spacing, accuracy: 0.00001)
                XCTAssertEqual(distances[after + offset] - center, (CGFloat(offset) + 0.5) * spacing, accuracy: 0.00001)
                XCTAssertEqual(tilt(after - 1 - offset) + tilt(after + offset), .pi / 2, accuracy: 0.00001)
            }
        }
    }
}
