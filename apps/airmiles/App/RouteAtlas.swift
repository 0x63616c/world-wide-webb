import AirMilesCore
import SwiftUI

/// Offline cartography. The bundled land shapes and airport coordinates are public domain.
struct RouteAtlas: View {
    var flights: [Flight]
    var airports: [String: Airport]
    var emphasized: Flight?
    var labels = true
    private static let land: [[[Double]]] = {
        guard let url = Bundle.main.url(forResource: "land", withExtension: "json"),
              let data = try? Data(contentsOf: url), let polygons = try? JSONDecoder().decode([[[Double]]].self, from: data) else { return [] }
        return polygons
    }()

    var body: some View {
        Canvas { context, size in
            let bounds = viewport
            func project(_ lon: Double, _ lat: Double) -> CGPoint {
                CGPoint(x: (lon - bounds.minLon) / (bounds.maxLon - bounds.minLon) * size.width,
                        y: (bounds.maxLat - lat) / (bounds.maxLat - bounds.minLat) * size.height)
            }
            // Fine graticule stays behind the geography and route network.
            var grid = Path()
            for lon in stride(from: -180.0, through: 180, by: 30) {
                grid.move(to: project(lon, -80)); grid.addLine(to: project(lon, 85))
            }
            for lat in stride(from: -60.0, through: 90, by: 30) {
                grid.move(to: project(-180, lat)); grid.addLine(to: project(180, lat))
            }
            context.stroke(grid, with: .color(.white.opacity(0.045)), lineWidth: 0.5)
            for polygon in Self.land {
                var path = Path()
                for (index, coordinate) in polygon.enumerated() {
                    let point = project(coordinate[0], coordinate[1])
                    if index == 0 { path.move(to: point) } else { path.addLine(to: point) }
                }
                path.closeSubpath()
                context.fill(path, with: .color(Color(white: 0.20)))
                context.stroke(path, with: .color(.white.opacity(0.13)), lineWidth: 0.5)
            }
            let unique = Dictionary(grouping: flights, by: { [$0.origin, $0.destination].sorted().joined() })
            for (_, group) in unique.sorted(by: { $0.key < $1.key }) {
                guard let flight = group.first, let from = airports[flight.origin], let to = airports[flight.destination] else { continue }
                let selected = emphasized.map { Set([$0.origin, $0.destination]) == Set([flight.origin, flight.destination]) } ?? false
                var path = Path(); var previous: CGPoint?
                for coordinate in greatCircle(from: from, to: to) {
                    let point = project(coordinate.0, coordinate.1)
                    if let previous, abs(previous.x - point.x) < size.width / 2 { path.addLine(to: point) }
                    else { path.move(to: point) }
                    previous = point
                }
                context.stroke(path, with: .color(.white.opacity(selected ? 0.98 : emphasized == nil ? 0.45 : 0.12)), style: StrokeStyle(lineWidth: selected ? 1.7 : 0.8, lineCap: .round))
            }
            let codes = Set(flights.flatMap { [$0.origin, $0.destination] })
            let selectedCodes = emphasized.map { Set([$0.origin, $0.destination]) } ?? []
            for code in codes.sorted() {
                guard let airport = airports[code] else { continue }
                let point = project(airport.longitude, airport.latitude)
                let selected = selectedCodes.contains(code)
                let radius: CGFloat = selected ? 3.5 : 2
                if selected {
                    context.fill(Path(ellipseIn: CGRect(x: point.x - 8, y: point.y - 8, width: 16, height: 16)), with: .color(.white.opacity(0.13)))
                }
                context.fill(Path(ellipseIn: CGRect(x: point.x - radius, y: point.y - radius, width: radius * 2, height: radius * 2)), with: .color(.white.opacity(0.9)))
                let keyAirports = ["LAX", "LHR", "PVG", "SYD", "JFK", "HND", "SIN"]
                if labels && (selected || emphasized == nil && keyAirports.contains(code)) {
                    context.draw(Text(code).font(.system(size: 10, weight: .medium, design: .monospaced)).foregroundStyle(.white.opacity(0.85)), at: CGPoint(x: point.x, y: point.y + 14))
                }
            }
        }.background(AMStyle.map).clipped()
            .accessibilityLabel("Route map, \(Set(flights.flatMap { [$0.origin, $0.destination] }).count) airports")
    }

    private var viewport: (minLon: Double, maxLon: Double, minLat: Double, maxLat: Double) {
        guard let emphasized, let a = airports[emphasized.origin], let b = airports[emphasized.destination], abs(a.longitude - b.longitude) < 160 else {
            return (-172, 172, -56, 83)
        }
        let points = greatCircle(from: a, to: b)
        let lons = points.map(\.0), lats = points.map(\.1)
        let minLon = lons.min() ?? a.longitude, maxLon = lons.max() ?? b.longitude
        let minLat = lats.min() ?? a.latitude, maxLat = lats.max() ?? b.latitude
        let width = max(20, maxLon - minLon) * 1.4
        let height = max(18, maxLat - minLat) * 2.0
        return ((minLon + maxLon) / 2 - width / 2, (minLon + maxLon) / 2 + width / 2,
                (minLat + maxLat) / 2 - height / 2, (minLat + maxLat) / 2 + height / 2)
    }

    private func greatCircle(from a: Airport, to b: Airport) -> [(Double, Double)] {
        func vector(_ airport: Airport) -> (Double, Double, Double) {
            let lat = airport.latitude * .pi / 180, lon = airport.longitude * .pi / 180
            return (cos(lat) * cos(lon), cos(lat) * sin(lon), sin(lat))
        }
        let a = vector(a), b = vector(b)
        let angle = acos(min(1, max(-1, a.0 * b.0 + a.1 * b.1 + a.2 * b.2)))
        guard angle > 0.00001, abs(sin(angle)) > 0.00001 else { return [] }
        return (0...70).map { step in
            let t = Double(step) / 70
            let first = sin((1-t)*angle) / sin(angle), second = sin(t*angle) / sin(angle)
            let x = first*a.0 + second*b.0, y = first*a.1 + second*b.1, z = first*a.2 + second*b.2
            return (atan2(y,x)*180 / .pi, atan2(z,sqrt(x*x+y*y))*180 / .pi)
        }
    }
}
