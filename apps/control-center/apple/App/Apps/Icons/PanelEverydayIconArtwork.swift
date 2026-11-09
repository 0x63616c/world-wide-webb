import SwiftUI

struct WalksIconArtwork: View {
    let side: CGFloat
    let parallax: CGSize
    var body: some View {
        ZStack {
            PanelEverydayShape.pawPad.fill(Color(hex: "#B1F2CE"))
                .offset(y: side * 0.035)
                .modifier(IconLayer(parallax: parallax, side: side, depth: 0.012))
            ZStack {
                Ellipse().fill(.white).frame(width: side * 0.145, height: side * 0.20)
                    .rotationEffect(.degrees(-25)).position(x: side * 0.265, y: side * 0.42)
                Ellipse().fill(.white).frame(width: side * 0.15, height: side * 0.21)
                    .rotationEffect(.degrees(-8)).position(x: side * 0.415, y: side * 0.29)
                Ellipse().fill(.white).frame(width: side * 0.15, height: side * 0.21)
                    .rotationEffect(.degrees(8)).position(x: side * 0.585, y: side * 0.29)
                Ellipse().fill(.white).frame(width: side * 0.145, height: side * 0.20)
                    .rotationEffect(.degrees(25)).position(x: side * 0.735, y: side * 0.42)
                PanelEverydayShape.pawPad.fill(.white)
            }.modifier(IconLayer(parallax: parallax, side: side, depth: 0.028))
        }.frame(width: side, height: side)
    }
}

struct CarIconArtwork: View {
    let side: CGFloat
    let parallax: CGSize
    var body: some View {
        ZStack {
            HStack(spacing: side * 0.245) {
                wheel
                wheel
            }
            .position(x: side * 0.51, y: side * 0.66)
            .modifier(IconLayer(parallax: parallax, side: side, depth: 0.012))
            ZStack {
                PanelEverydayShape.carBody.fill(.white)
                PanelEverydayShape.carWindow.fill(Color(hex: "#85C8FA"))
                Capsule().fill(Color(hex: "#BCDFFB"))
                    .frame(width: side * 0.07, height: side * 0.022)
                    .position(x: side * 0.57, y: side * 0.535)
                Capsule().fill(Color(hex: "#FFDF66"))
                    .frame(width: side * 0.075, height: side * 0.034)
                    .rotationEffect(.degrees(10))
                    .position(x: side * 0.79, y: side * 0.535)
            }.modifier(IconLayer(parallax: parallax, side: side, depth: 0.028))
        }.frame(width: side, height: side)
    }
    private var wheel: some View {
        Circle().fill(Color(hex: "#2456A7"))
            .overlay { Circle().fill(Color(hex: "#C9E7FF")).padding(side * 0.036) }
            .frame(width: side * 0.16, height: side * 0.16)
    }
}

struct ClockIconArtwork: View {
    let side: CGFloat
    let parallax: CGSize
    var body: some View {
        ZStack {
            Circle().fill(Color(hex: "#B3ECDD"))
                .frame(width: side * 0.64, height: side * 0.64)
                .offset(y: side * 0.025)
                .modifier(IconLayer(parallax: parallax, side: side, depth: 0.012))
            ZStack {
                Circle().fill(.white).frame(width: side * 0.64, height: side * 0.64)
                ForEach(0..<4) { index in
                    Capsule().fill(Color(hex: "#C0DCD4"))
                        .frame(width: side * 0.021, height: side * 0.043)
                        .offset(y: -side * 0.253)
                        .rotationEffect(.degrees(Double(index) * 90))
                }
                Path { path in
                    path.move(to: CGPoint(x: side * 0.50, y: side * 0.32))
                    path.addLine(to: CGPoint(x: side * 0.50, y: side * 0.50))
                    path.addLine(to: CGPoint(x: side * 0.65, y: side * 0.57))
                }.stroke(
                    Color(hex: "#228D70"),
                    style: StrokeStyle(lineWidth: side * 0.043, lineCap: .round, lineJoin: .round))
                Circle().fill(Color(hex: "#228D70")).frame(width: side * 0.065, height: side * 0.065)
            }.modifier(IconLayer(parallax: parallax, side: side, depth: 0.028))
        }.frame(width: side, height: side)
    }
}

struct TimerIconArtwork: View {
    let side: CGFloat
    let parallax: CGSize
    var body: some View {
        ZStack {
            ZStack {
                Capsule().fill(Color(hex: "#FFE8B7"))
                    .frame(width: side * 0.17, height: side * 0.07)
                    .position(x: side * 0.50, y: side * 0.205)
                Capsule().fill(Color(hex: "#FFE8B7"))
                    .frame(width: side * 0.11, height: side * 0.06)
                    .rotationEffect(.degrees(45))
                    .position(x: side * 0.72, y: side * 0.30)
            }.modifier(IconLayer(parallax: parallax, side: side, depth: 0.012))
            ZStack {
                Circle().stroke(.white, lineWidth: side * 0.062)
                    .frame(width: side * 0.53, height: side * 0.53)
                    .position(x: side * 0.50, y: side * 0.555)
                Path { path in
                    path.move(to: CGPoint(x: side * 0.50, y: side * 0.385))
                    path.addLine(to: CGPoint(x: side * 0.50, y: side * 0.555))
                    path.addLine(to: CGPoint(x: side * 0.61, y: side * 0.62))
                }.stroke(.white, style: StrokeStyle(lineWidth: side * 0.045, lineCap: .round, lineJoin: .round))
            }.modifier(IconLayer(parallax: parallax, side: side, depth: 0.028))
        }.frame(width: side, height: side)
    }
}

struct BoothIconArtwork: View {
    let side: CGFloat
    let parallax: CGSize
    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: side * 0.04).fill(Color(hex: "#FFD2E2"))
                .overlay {
                    RoundedRectangle(cornerRadius: side * 0.018).fill(Color(hex: "#F39AB8"))
                        .padding(side * 0.035)
                }
                .frame(width: side * 0.42, height: side * 0.40)
                .rotationEffect(.degrees(-9))
                .position(x: side * 0.435, y: side * 0.395)
                .modifier(IconLayer(parallax: parallax, side: side, depth: 0.012))
            ZStack {
                RoundedRectangle(cornerRadius: side * 0.05).fill(.white)
                    .frame(width: side * 0.25, height: side * 0.13)
                    .position(x: side * 0.50, y: side * 0.365)
                RoundedRectangle(cornerRadius: side * 0.07).fill(.white)
                    .frame(width: side * 0.65, height: side * 0.43)
                    .position(x: side * 0.50, y: side * 0.565)
                Circle().fill(Color(hex: "#D44F86"))
                    .frame(width: side * 0.28, height: side * 0.28)
                    .position(x: side * 0.50, y: side * 0.56)
                Circle().fill(Color(hex: "#F9ABC8"))
                    .frame(width: side * 0.18, height: side * 0.18)
                    .position(x: side * 0.50, y: side * 0.56)
                Circle().fill(Color(hex: "#D44F86"))
                    .frame(width: side * 0.042, height: side * 0.042)
                    .position(x: side * 0.71, y: side * 0.44)
            }.modifier(IconLayer(parallax: parallax, side: side, depth: 0.028))
        }.frame(width: side, height: side)
    }
}

private enum PanelEverydayShape: Shape {
    case pawPad, carBody, carWindow, compassNorth, compassSouth
    func path(in rect: CGRect) -> Path {
        var path = Path()
        switch self {
        case .pawPad:
            path.move(to: CGPoint(x: 500, y: 453))
            path.addCurve(
                to: CGPoint(x: 652, y: 587), control1: CGPoint(x: 575, y: 453), control2: CGPoint(x: 587, y: 523))
            path.addCurve(
                to: CGPoint(x: 659, y: 760), control1: CGPoint(x: 745, y: 676), control2: CGPoint(x: 740, y: 760))
            path.addCurve(
                to: CGPoint(x: 500, y: 725), control1: CGPoint(x: 594, y: 760), control2: CGPoint(x: 561, y: 725))
            path.addCurve(
                to: CGPoint(x: 341, y: 760), control1: CGPoint(x: 439, y: 725), control2: CGPoint(x: 406, y: 760))
            path.addCurve(
                to: CGPoint(x: 348, y: 587), control1: CGPoint(x: 260, y: 760), control2: CGPoint(x: 255, y: 676))
            path.addCurve(
                to: CGPoint(x: 500, y: 453), control1: CGPoint(x: 413, y: 523), control2: CGPoint(x: 425, y: 453))
        case .carBody:
            path.move(to: CGPoint(x: 175, y: 628))
            path.addQuadCurve(to: CGPoint(x: 178, y: 492), control: CGPoint(x: 142, y: 593))
            path.addLine(to: CGPoint(x: 283, y: 465))
            path.addCurve(
                to: CGPoint(x: 471, y: 321), control1: CGPoint(x: 342, y: 370), control2: CGPoint(x: 391, y: 321))
            path.addCurve(
                to: CGPoint(x: 661, y: 447), control1: CGPoint(x: 561, y: 313), control2: CGPoint(x: 624, y: 399))
            path.addLine(to: CGPoint(x: 790, y: 480))
            path.addQuadCurve(to: CGPoint(x: 846, y: 562), control: CGPoint(x: 844, y: 494))
            path.addQuadCurve(to: CGPoint(x: 809, y: 631), control: CGPoint(x: 857, y: 626))
            path.addLine(to: CGPoint(x: 175, y: 631))
        case .carWindow:
            path.move(to: CGPoint(x: 349, y: 452))
            path.addQuadCurve(to: CGPoint(x: 473, y: 369), control: CGPoint(x: 410, y: 371))
            path.addQuadCurve(to: CGPoint(x: 604, y: 452), control: CGPoint(x: 540, y: 368))
        case .compassNorth:
            path.move(to: CGPoint(x: 500, y: 254))
            path.addLine(to: CGPoint(x: 609, y: 500))
            path.addLine(to: CGPoint(x: 391, y: 500))
        case .compassSouth:
            path.move(to: CGPoint(x: 500, y: 746))
            path.addLine(to: CGPoint(x: 391, y: 500))
            path.addLine(to: CGPoint(x: 609, y: 500))
        }
        path.closeSubpath()
        return path.applying(
            CGAffineTransform(scaleX: rect.width / 1000, y: rect.height / 1000)
                .concatenating(CGAffineTransform(translationX: rect.minX, y: rect.minY)))
    }
}
