import AirMilesCore
import SceneKit
import SwiftUI
import Observation

@MainActor @Observable final class GlobeInteraction {
    var spinning = true
    var changedByUser = false
    var resetToken = 0
    var zoomCommand = 0
    var zoom = 1.0
}

/// Offline globe. Routes illustrate great circles, not actual flight tracks.
struct RouteAtlas: View {
    var flights: [Flight]
    var airports: [String: Airport]
    var emphasized: Flight?
    var spinning = true
    var interaction: GlobeInteraction?
    var showsStars = true
    @State private var localInteraction = GlobeInteraction()
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.colorScheme) private var colorScheme
    @State private var visible = false

    var body: some View {
        let state = interaction ?? localInteraction
        GlobeScene(flights: flights, airports: airports, emphasized: emphasized,
                   animate: spinning && state.spinning && emphasized == nil && !reduceMotion && visible && scenePhase == .active && !ProcessInfo.processInfo.arguments.contains("--screenshots"),
                   interaction: state, resetToken: state.resetToken, zoomCommand: state.zoomCommand, reduceMotion: reduceMotion)
            .background {
                if showsStars && colorScheme == .dark { StarField().allowsHitTesting(false).accessibilityHidden(true) }
            }
            .onAppear { visible = true }.onDisappear { visible = false }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("Flight globe, \(Set(flights.flatMap { [$0.origin, $0.destination] }).count) airports")
            .accessibilityValue("Zoom \(state.zoom.formatted(.number.precision(.fractionLength(1))))")
            .accessibilityHint("Drag to explore. Pinch to zoom. Double-tap to reset.")
            .accessibilityIdentifier("flightGlobe")
            .accessibilityAction(named: "Zoom in") { state.zoomCommand += 1 }
            .accessibilityAction(named: "Zoom out") { state.zoomCommand -= 1 }
            .accessibilityAction(named: "Reset globe") { state.resetToken += 1 }
    }
}

/// A quiet, deterministic sky: no twinkle, random redraws or extra animation timer.
struct StarField: View {
    var body: some View {
        Canvas { context, size in
            for index in 0..<110 {
                let x = CGFloat((index * 7919 + 173) % 10007) / 10007 * size.width
                let y = CGFloat((index * 3571 + 991) % 9973) / 9973 * size.height
                let radius: CGFloat = index.isMultiple(of: 17) ? 0.9 : 0.5
                let opacity = index.isMultiple(of: 17) ? 0.55 : 0.16 + Double(index % 5) * 0.045
                // Feather the sky into its surrounding black instead of outlining a panel.
                let edge = min(x, size.width - x, y, size.height - y)
                let fade = min(1, max(0, edge / 28))
                context.fill(Path(ellipseIn: CGRect(x: x, y: y, width: radius * 2, height: radius * 2)),
                             with: .color(.white.opacity(opacity * fade)))
            }
        }
    }
}

private struct GlobeScene: UIViewRepresentable {
    var flights: [Flight]
    var airports: [String: Airport]
    var emphasized: Flight?
    var animate: Bool
    var interaction: GlobeInteraction
    var resetToken: Int
    var zoomCommand: Int
    var reduceMotion: Bool

    func makeCoordinator() -> Coordinator { Coordinator() }
    func makeUIView(context: Context) -> SCNView {
        let view = GlobeSceneView()
        view.backgroundColor = .clear
        view.isOpaque = false
        view.antialiasingMode = .multisampling4X
        view.preferredFramesPerSecond = 30
        let pan = UIPanGestureRecognizer(target: context.coordinator, action: #selector(Coordinator.pan(_:)))
        let pinch = UIPinchGestureRecognizer(target: context.coordinator, action: #selector(Coordinator.pinch(_:)))
        pan.delegate = context.coordinator; pinch.delegate = context.coordinator
        view.addGestureRecognizer(pan); view.addGestureRecognizer(pinch)
        let reset = UITapGestureRecognizer(target: context.coordinator, action: #selector(Coordinator.reset))
        reset.numberOfTapsRequired = 2
        view.addGestureRecognizer(reset)
        context.coordinator.view = view
        view.onLayout = { [weak coordinator = context.coordinator] in coordinator?.fitCamera() }
        return view
    }
    func updateUIView(_ view: SCNView, context: Context) {
        context.coordinator.interaction = interaction
        context.coordinator.reduceMotion = reduceMotion
        let signature = flights.map { "\($0.origin)-\($0.destination)" }.sorted().joined(separator: ",") + (emphasized?.id ?? "")
        if context.coordinator.signature != signature {
            context.coordinator.signature = signature
            context.coordinator.build(flights: flights, airports: airports, emphasized: emphasized)
        }
        if context.coordinator.resetToken != resetToken {
            context.coordinator.resetToken = resetToken
            context.coordinator.reset()
        }
        if context.coordinator.zoomCommand != zoomCommand {
            let change = zoomCommand - context.coordinator.zoomCommand
            context.coordinator.zoomCommand = zoomCommand
            Task { @MainActor [weak coordinator = context.coordinator] in
                coordinator?.zoom(by: pow(1.25, Double(change)))
            }
        }
        context.coordinator.shouldAnimate = animate
        context.coordinator.updateAnimation()
    }
    static func dismantleUIView(_ view: SCNView, coordinator: Coordinator) {
        coordinator.shouldAnimate = false
        coordinator.updateAnimation()
        view.scene = nil
    }

    @MainActor final class Coordinator: NSObject, UIGestureRecognizerDelegate {
        weak var view: SCNView?
        var signature: String?
        var world = SCNNode()
        var tilt = SCNNode()
        var shouldAnimate = false
        var interaction: GlobeInteraction?
        var reduceMotion = false
        var resetToken = 0
        var zoomCommand = 0
        private var camera = SCNNode()
        private var routeNodes = SCNNode()
        private var focusID: String?
        private var browsePose: (yaw: Float, tilt: Float, zoom: Double)?
        private var zoomLevel = 1.0
        private var orienting = false
        private var orientationGeneration = 0
        private var homeYaw: Float = .pi / 4
        private var homeTilt: Float = .pi / 7
        private var pinching = false
        private var pinchScale = 1.0
        private var dragging = false
        private var initialYaw: Float = 0
        private var initialTilt: Float = 0

        func build(flights: [Flight], airports: [String: Airport], emphasized: Flight?) {
            stopSpin()
            if view?.scene == nil {
                let scene = SCNScene()
                scene.rootNode.addChildNode(tilt); tilt.addChildNode(world)
                tilt.eulerAngles.x = homeTilt
                world.eulerAngles.y = homeYaw
                let earth = SCNNode(geometry: Self.sphere())
                let material = SCNMaterial()
                material.diffuse.contents = Self.texture
                material.lightingModel = .lambert
                earth.geometry?.materials = [material]
                world.addChildNode(earth)
                world.addChildNode(routeNodes)
                let ambient = SCNNode(); ambient.light = SCNLight()
                ambient.light?.type = .ambient; ambient.light?.intensity = 500
                scene.rootNode.addChildNode(ambient)
                let sunlight = SCNNode(); sunlight.light = SCNLight()
                sunlight.light?.type = .omni; sunlight.light?.intensity = 450
                sunlight.position = SCNVector3(-3, 5, 5)
                scene.rootNode.addChildNode(sunlight)
                camera.camera = SCNCamera()
                camera.camera?.usesOrthographicProjection = true
                camera.camera?.projectionDirection = .vertical
                camera.camera?.orthographicScale = 1.16
                camera.camera?.zNear = 0.1; camera.camera?.zFar = 10
                camera.position = SCNVector3(0, 0, 4)
                scene.rootNode.addChildNode(camera)
                view?.scene = scene; view?.pointOfView = camera
                fitCamera()
            }
            if focusID != emphasized?.id {
                if let flight = emphasized, let from = airports[flight.origin], let to = airports[flight.destination] {
                    if focusID == nil {
                        browsePose = (world.eulerAngles.y, tilt.eulerAngles.x, zoomLevel)
                    }
                    let midpoint = (point(from) + point(to)).unit
                    homeYaw = -atan2(midpoint.x, midpoint.z); homeTilt = asin(midpoint.y)
                    orient(yaw: homeYaw, pitch: homeTilt, zoom: 1)
                } else if let pose = browsePose {
                    orient(yaw: pose.yaw, pitch: pose.tilt, zoom: pose.zoom)
                    homeYaw = .pi / 4; homeTilt = .pi / 7; browsePose = nil
                }
                focusID = emphasized?.id
            }
            routeNodes.childNodes.forEach { $0.removeFromParentNode() }
            let unique = Dictionary(grouping: flights, by: { [$0.origin, $0.destination].sorted().joined() })
            for key in unique.keys.sorted() {
                guard let flight = unique[key]?.first, let from = airports[flight.origin], let to = airports[flight.destination] else { continue }
                routeNodes.addChildNode(Self.arc(from: point(from), to: point(to), emphasized: emphasized != nil, outline: true))
                routeNodes.addChildNode(Self.arc(from: point(from), to: point(to), emphasized: emphasized != nil))
            }
            for code in Set(flights.flatMap { [$0.origin, $0.destination] }).sorted() {
                guard let airport = airports[code] else { continue }
                let dot = SCNSphere(radius: emphasized == nil ? 0.008 : 0.011)
                dot.segmentCount = 10
                dot.firstMaterial = Self.white(opacity: 1)
                let node = SCNNode(geometry: dot); node.position = point(airport) * 1.012
                routeNodes.addChildNode(node)
            }

        }

        func updateAnimation() {
            if shouldAnimate && !dragging && !pinching && !orienting {
                if world.action(forKey: "spin") == nil {
                    let spin = SCNAction.rotateBy(x: 0, y: .pi * 2, z: 0, duration: 180 * max(1, zoomLevel))
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
                dragging = true; beginInteraction()
                initialYaw = world.eulerAngles.y; initialTilt = tilt.eulerAngles.x
            case .changed:
                let translation = gesture.translation(in: gesture.view)
                world.eulerAngles.y = initialYaw + Float(translation.x) * 0.006 / Float(zoomLevel)
                tilt.eulerAngles.x = min(1.25, max(-1.25, initialTilt + Float(translation.y) * 0.006 / Float(zoomLevel)))
            case .ended, .cancelled, .failed:
                dragging = false; updateAnimation()
            default: break
            }
        }
        private func beginInteraction() {
            let visibleWorld = world.presentation.transform
            let visibleTilt = tilt.presentation.transform
            let visibleScale = camera.presentation.camera?.orthographicScale ?? camera.camera?.orthographicScale ?? 1.16
            stopSpin()
            world.removeAllAnimations()
            tilt.removeAllAnimations()
            camera.camera?.removeAllAnimations()
            SCNTransaction.begin()
            SCNTransaction.disableActions = true
            world.transform = visibleWorld
            tilt.transform = visibleTilt
            camera.camera?.orthographicScale = visibleScale
            SCNTransaction.commit()
            zoomLevel = fittedScale / max(0.001, visibleScale)
            orientationGeneration += 1
            orienting = false
            interaction?.spinning = false
            interaction?.changedByUser = true
        }
        @objc func pinch(_ gesture: UIPinchGestureRecognizer) {
            switch gesture.state {
            case .began:
                pinching = true; beginInteraction()
                pinchScale = zoomLevel
            case .changed:
                setZoom(pinchScale * gesture.scale)
            case .ended, .cancelled, .failed:
                pinching = false; updateAnimation()
            default: break
            }
        }
        func zoom(by factor: Double) {
            beginInteraction()
            setZoom(zoomLevel * factor)
        }
        @objc func reset() {
            stopSpin()
            orient(yaw: homeYaw, pitch: homeTilt, zoom: 1)
            // Defer observable updates out of UIViewRepresentable's update pass.
            Task { @MainActor [weak self] in
                self?.interaction?.changedByUser = false
                self?.interaction?.zoom = 1
            }
        }
        private func setZoom(_ value: Double) {
            zoomLevel = min(3, max(0.75, value))
            interaction?.zoom = zoomLevel
            fitCamera()
        }
        func fitCamera() {
            guard let view, view.bounds.width > 0, view.bounds.height > 0 else { return }
            // Fit the sphere and raised routes in either pane aspect ratio.
            camera.camera?.orthographicScale = fittedScale / zoomLevel
        }
        private var fittedScale: Double {
            guard let view, view.bounds.width > 0 else { return 1.16 }
            return 1.16 * max(1, view.bounds.height / view.bounds.width)
        }
        private func orient(yaw: Float, pitch: Float, zoom: Double) {
            zoomLevel = zoom
            orientationGeneration += 1
            let generation = orientationGeneration
            orienting = !reduceMotion
            SCNTransaction.begin()
            SCNTransaction.animationDuration = reduceMotion ? 0 : 0.5
            SCNTransaction.animationTimingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
            // Choose the nearest equivalent longitude rather than orbiting around the far side.
            let delta = atan2(sin(yaw - world.eulerAngles.y), cos(yaw - world.eulerAngles.y))
            world.eulerAngles.y += delta
            tilt.eulerAngles.x = pitch
            fitCamera()
            SCNTransaction.commit()
            Task { @MainActor [weak self] in
                guard let self else { return }
                interaction?.zoom = zoomLevel
                if !reduceMotion { try? await Task.sleep(for: .milliseconds(500)) }
                guard generation == orientationGeneration else { return }
                orienting = false
                updateAnimation()
            }
        }
        func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool {
            (gestureRecognizer is UIPinchGestureRecognizer && other is UIPanGestureRecognizer) ||
            (gestureRecognizer is UIPanGestureRecognizer && other is UIPinchGestureRecognizer)
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
        private static func arc(from a: SCNVector3, to b: SCNVector3, emphasized: Bool, outline: Bool = false) -> SCNNode {
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
            let sides = 6, radius: Float = (emphasized ? 0.0028 : 0.0018) * (outline ? 2.2 : 1)
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
            let material = white(opacity: emphasized ? 1 : 0.9)
            if outline {
                material.diffuse.contents = UIColor(white: 0.04, alpha: 0.55)
                material.writesToDepthBuffer = false
            }
            material.isDoubleSided = true
            geometry.materials = [material]
            let node = SCNNode(geometry: geometry)
            node.renderingOrder = outline ? 1 : 2
            return node
        }
        private static let texture: UIImage = {
            if let url = Bundle.main.url(forResource: "earth", withExtension: "jpg"),
               let image = UIImage(contentsOfFile: url.path) { return image }
            let size = CGSize(width: 2048, height: 1024)
            let format = UIGraphicsImageRendererFormat(); format.scale = 1; format.opaque = true
            let rendered = UIGraphicsImageRenderer(size: size, format: format).image { renderer in
                let context = renderer.cgContext
                context.setFillColor(UIColor(red: 0.16, green: 0.36, blue: 0.54, alpha: 1).cgColor)
                context.fill(CGRect(origin: .zero, size: size))
                guard let url = Bundle.main.url(forResource: "land", withExtension: "json"),
                      let data = try? Data(contentsOf: url), let land = try? JSONDecoder().decode([[[Double]]].self, from: data) else { return }
                context.setFillColor(UIColor(red: 0.48, green: 0.61, blue: 0.43, alpha: 1).cgColor)
                context.setStrokeColor(UIColor(red: 0.57, green: 0.66, blue: 0.49, alpha: 1).cgColor)
                context.setLineWidth(0.65)
                for polygon in land {
                    context.beginPath()
                    for (index, coordinate) in polygon.enumerated() {
                        let point = CGPoint(x: (coordinate[0] + 180) / 360 * size.width, y: (90 - coordinate[1]) / 180 * size.height)
                        if index == 0 { context.move(to: point) } else { context.addLine(to: point) }
                    }
                    context.closePath(); context.drawPath(using: .fillStroke)
                }

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

private final class GlobeSceneView: SCNView {
    var onLayout: (() -> Void)?
    override func layoutSubviews() {
        super.layoutSubviews()
        onLayout?()
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
