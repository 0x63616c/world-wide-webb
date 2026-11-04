import AirMilesCore
import SceneKit
import SwiftUI

/// An offline, depth-tested globe. Routes are illustrative great circles, not flown tracks.
struct RouteAtlas: View {
    var flights: [Flight]
    var airports: [String: Airport]
    var emphasized: Flight?
    var spinning = true
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var scenePhase
    @State private var visible = false

    var body: some View {
        GlobeScene(flights: flights, airports: airports, emphasized: emphasized,
                   animate: spinning && !reduceMotion && visible && scenePhase == .active && !ProcessInfo.processInfo.arguments.contains("--screenshots"))
            .onAppear { visible = true }.onDisappear { visible = false }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("Flight globe, \(Set(flights.flatMap { [$0.origin, $0.destination] }).count) airports")
            .accessibilityHint("Drag to rotate")
    }
}

private struct GlobeScene: UIViewRepresentable {
    var flights: [Flight]
    var airports: [String: Airport]
    var emphasized: Flight?
    var animate: Bool

    func makeCoordinator() -> Coordinator { Coordinator() }
    func makeUIView(context: Context) -> SCNView {
        let view = SCNView()
        view.backgroundColor = .clear
        view.isOpaque = false
        view.antialiasingMode = .multisampling4X
        view.preferredFramesPerSecond = 30
        view.addGestureRecognizer(UIPanGestureRecognizer(target: context.coordinator, action: #selector(Coordinator.pan(_:))))
        context.coordinator.view = view
        return view
    }
    func updateUIView(_ view: SCNView, context: Context) {
        let signature = flights.map { "\($0.origin)-\($0.destination)" }.sorted().joined(separator: ",") + (emphasized?.id ?? "")
        if context.coordinator.signature != signature {
            context.coordinator.signature = signature
            context.coordinator.build(flights: flights, airports: airports, emphasized: emphasized)
        }
        context.coordinator.shouldAnimate = animate
        context.coordinator.updateAnimation()
    }
    static func dismantleUIView(_ view: SCNView, coordinator: Coordinator) {
        coordinator.shouldAnimate = false
        coordinator.updateAnimation()
        view.scene = nil
    }

    @MainActor final class Coordinator: NSObject {
        weak var view: SCNView?
        var signature: String?
        var world = SCNNode()
        var tilt = SCNNode()
        var shouldAnimate = false
        private var dragging = false
        private var initialYaw: Float = 0
        private var initialTilt: Float = 0

        func build(flights: [Flight], airports: [String: Airport], emphasized: Flight?) {
            let scene = SCNScene()
            world = SCNNode(); tilt = SCNNode()
            scene.rootNode.addChildNode(tilt); tilt.addChildNode(world)
            tilt.eulerAngles.x = .pi / 7
            world.eulerAngles.y = .pi / 4
            if let flight = emphasized, let from = airports[flight.origin], let to = airports[flight.destination] {
                let midpoint = (point(from) + point(to)).unit
                world.eulerAngles.y = -atan2(midpoint.x, midpoint.z)
                tilt.eulerAngles.x = asin(midpoint.y)
            }
            let earth = SCNNode(geometry: Self.sphere())
            let material = SCNMaterial()
            material.diffuse.contents = Self.texture
            material.lightingModel = .constant
            earth.geometry?.materials = [material]
            world.addChildNode(earth)

            let unique = Dictionary(grouping: flights, by: { [$0.origin, $0.destination].sorted().joined() })
            for key in unique.keys.sorted() {
                guard let flight = unique[key]?.first, let from = airports[flight.origin], let to = airports[flight.destination] else { continue }
                world.addChildNode(Self.arc(from: point(from), to: point(to), emphasized: emphasized != nil))
            }
            for code in Set(flights.flatMap { [$0.origin, $0.destination] }).sorted() {
                guard let airport = airports[code] else { continue }
                let dot = SCNSphere(radius: emphasized == nil ? 0.006 : 0.009)
                dot.segmentCount = 10
                dot.firstMaterial = Self.white(opacity: 1)
                let node = SCNNode(geometry: dot); node.position = point(airport) * 1.012
                world.addChildNode(node)
            }
            let camera = SCNNode()
            camera.camera = SCNCamera()
            camera.camera?.usesOrthographicProjection = true
            camera.camera?.orthographicScale = 1.16
            camera.camera?.zNear = 0.1
            camera.camera?.zFar = 10
            camera.position = SCNVector3(0, 0, 4)
            scene.rootNode.addChildNode(camera)
            view?.scene = scene
            view?.pointOfView = camera
        }

        func updateAnimation() {
            if shouldAnimate && !dragging {
                if world.action(forKey: "spin") == nil {
                    let spin = SCNAction.rotateBy(x: 0, y: .pi * 2, z: 0, duration: 180)
                    world.runAction(.repeatForever(spin), forKey: "spin")
                }
                view?.isPlaying = true
            } else {
                stopSpin()
                view?.isPlaying = false
            }
        }
        private func stopSpin() {
            guard world.action(forKey: "spin") != nil else { return }
            let orientation = world.presentation.orientation
            world.removeAction(forKey: "spin")
            world.orientation = orientation
        }
        @objc func pan(_ gesture: UIPanGestureRecognizer) {
            switch gesture.state {
            case .began:
                dragging = true; stopSpin()
                initialYaw = world.eulerAngles.y; initialTilt = tilt.eulerAngles.x
            case .changed:
                let translation = gesture.translation(in: gesture.view)
                world.eulerAngles.y = initialYaw + Float(translation.x) * 0.006
                tilt.eulerAngles.x = min(1.25, max(-1.25, initialTilt + Float(translation.y) * 0.006))
            case .ended, .cancelled, .failed:
                dragging = false; updateAnimation()
            default: break
            }
        }
        private func point(_ airport: Airport) -> SCNVector3 {
            Self.point(longitude: airport.longitude, latitude: airport.latitude)
        }
        private static func point(longitude: Double, latitude: Double) -> SCNVector3 {
            let lat = latitude * .pi / 180, lon = longitude * .pi / 180
            return SCNVector3(cos(lat) * sin(lon), sin(lat), cos(lat) * cos(lon))
        }
        private static func white(opacity: CGFloat) -> SCNMaterial {
            let material = SCNMaterial()
            material.diffuse.contents = UIColor(white: 1, alpha: opacity)
            material.lightingModel = .constant
            return material
        }
        private static func sphere() -> SCNGeometry {
            let columns = 144, rows = 72
            var vertices: [SCNVector3] = [], uv: [CGPoint] = [], indices: [Int32] = []
            for row in 0...rows {
                for column in 0...columns {
                    vertices.append(point(longitude: Double(column) / Double(columns) * 360 - 180,
                                          latitude: 90 - Double(row) / Double(rows) * 180))
                    uv.append(CGPoint(x: Double(column) / Double(columns), y: Double(row) / Double(rows)))
                }
            }
            for row in 0..<rows {
                for column in 0..<columns {
                    let a = Int32(row * (columns + 1) + column), b = a + Int32(columns + 1)
                    indices += [a, b, a + 1, a + 1, b, b + 1]
                }
            }
            return SCNGeometry(sources: [SCNGeometrySource(vertices: vertices), SCNGeometrySource(normals: vertices), SCNGeometrySource(textureCoordinates: uv)],
                               elements: [SCNGeometryElement(indices: indices, primitiveType: .triangles)])
        }
        private static func arc(from a: SCNVector3, to b: SCNVector3, emphasized: Bool) -> SCNNode {
            let angle = acos(min(1, max(-1, a.dot(b))))
            guard angle > 0.0001 else { return SCNNode() }
            var points: [SCNVector3] = []
            for step in 0...80 {
                let t = Float(step) / 80
                let direction: SCNVector3
                if abs(sin(angle)) < 0.0001 {
                    // Stable great-circle fallback for antipodal endpoints.
                    let axis = a.cross(abs(a.y) < 0.9 ? SCNVector3(0, 1, 0) : SCNVector3(1, 0, 0)).unit
                    direction = a * cos(.pi * t) + axis * sin(.pi * t)
                } else {
                    direction = a * (sin((1 - t) * angle) / sin(angle)) + b * (sin(t * angle) / sin(angle))
                }
                points.append(direction.unit * (1.012 + 0.055 * sin(.pi * t)))
            }
            var vertices: [SCNVector3] = [], indices: [Int32] = []
            let sides = 6, radius: Float = emphasized ? 0.0028 : 0.0018
            for (index, center) in points.enumerated() {
                let tangent = (points[min(index + 1, points.count - 1)] - points[max(index - 1, 0)]).unit
                let normal = tangent.cross(center).unit, binormal = tangent.cross(normal).unit
                for side in 0..<sides {
                    let theta = Float(side) / Float(sides) * .pi * 2
                    vertices.append(center + normal * (cos(theta) * radius) + binormal * (sin(theta) * radius))
                }
            }
            for ring in 0..<(points.count - 1) {
                for side in 0..<sides {
                    let a = Int32(ring * sides + side), b = Int32(ring * sides + (side + 1) % sides)
                    let c = a + Int32(sides), d = b + Int32(sides)
                    indices += [a, b, c, b, d, c]
                }
            }
            let geometry = SCNGeometry(sources: [SCNGeometrySource(vertices: vertices)], elements: [SCNGeometryElement(indices: indices, primitiveType: .triangles)])
            let material = white(opacity: emphasized ? 1 : 0.64)
            material.isDoubleSided = true
            geometry.materials = [material]
            return SCNNode(geometry: geometry)
        }
        private static let texture: UIImage = {
            let size = CGSize(width: 2048, height: 1024)
            let format = UIGraphicsImageRendererFormat(); format.scale = 1; format.opaque = true
            let rendered = UIGraphicsImageRenderer(size: size, format: format).image { renderer in
                let context = renderer.cgContext
                context.setFillColor(UIColor.black.cgColor)
                context.fill(CGRect(origin: .zero, size: size))
                guard let url = Bundle.main.url(forResource: "land", withExtension: "json"),
                      let data = try? Data(contentsOf: url), let land = try? JSONDecoder().decode([[[Double]]].self, from: data) else { return }
                context.setFillColor(UIColor(white: 0.18, alpha: 1).cgColor)
                context.setStrokeColor(UIColor(white: 0.30, alpha: 1).cgColor)
                context.setLineWidth(0.65)
                for polygon in land {
                    context.beginPath()
                    for (index, coordinate) in polygon.enumerated() {
                        let point = CGPoint(x: (coordinate[0] + 180) / 360 * size.width, y: (90 - coordinate[1]) / 180 * size.height)
                        if index == 0 { context.move(to: point) } else { context.addLine(to: point) }
                    }
                    context.closePath(); context.drawPath(using: .fillStroke)
                }
                context.setStrokeColor(UIColor(white: 0.5, alpha: 0.1).cgColor)
                context.setLineWidth(0.5)
                for longitude in stride(from: 0.0, through: 360, by: 30) {
                    context.move(to: CGPoint(x: longitude / 360 * size.width, y: 0))
                    context.addLine(to: CGPoint(x: longitude / 360 * size.width, y: size.height))
                }
                for latitude in stride(from: 0.0, through: 180, by: 30) {
                    context.move(to: CGPoint(x: 0, y: latitude / 180 * size.height))
                    context.addLine(to: CGPoint(x: size.width, y: latitude / 180 * size.height))
                }
                context.strokePath()
            }
            // UIGraphics optimizes monochrome drawings into an R8 texture that
            // SceneKit's simulator renderer cannot upload. Supply explicit RGBA8.
            guard let image = rendered.cgImage,
                  let rgb = CGContext(data: nil, width: 2048, height: 1024, bitsPerComponent: 8,
                                      bytesPerRow: 2048 * 4, space: CGColorSpaceCreateDeviceRGB(),
                                      bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return rendered }
            rgb.draw(image, in: CGRect(origin: .zero, size: size))
            return rgb.makeImage().map { UIImage(cgImage: $0) } ?? rendered
        }()
    }
}

private extension SCNVector3 {
    static func + (a: Self, b: Self) -> Self { Self(a.x + b.x, a.y + b.y, a.z + b.z) }
    static func - (a: Self, b: Self) -> Self { Self(a.x - b.x, a.y - b.y, a.z - b.z) }
    static func * (a: Self, b: Float) -> Self { Self(a.x * b, a.y * b, a.z * b) }
    func dot(_ b: Self) -> Float { x * b.x + y * b.y + z * b.z }
    func cross(_ b: Self) -> Self { Self(y * b.z - z * b.y, z * b.x - x * b.z, x * b.y - y * b.x) }
    var unit: Self { self * (1 / max(0.000001, sqrt(dot(self)))) }
}
