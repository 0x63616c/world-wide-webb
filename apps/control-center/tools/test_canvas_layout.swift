import CoreGraphics
import Foundation

/// Exercise the production layout policy directly on the Mac, without booting
/// an iOS runtime. UIKit rendering and real gestures remain separate UI checks.
@main
enum CanvasLayoutCheck {
    static func main() {
        let expected: [(PanelCanvasProfile, CGSize, Int, CGFloat, CGFloat)] = [
            (.iPad, CGSize(width: 1366, height: 1024), 5, 112, 21),
            (.duoClosed, CGSize(width: 466, height: 678), 3, 76, 15),
            (.duoOpen, CGSize(width: 951, height: 669), 5, 96, 18),
        ]
        for (profile, size, columns, icon, label) in expected {
            precondition(profile.size == size)
            precondition(PanelCanvasProfile.resolve(size: size) == profile)
            precondition(PanelCanvasProfile.resolve(size: CGSize(width: size.height, height: size.width)) == profile)
            let launcher = LauncherLayout(profile: profile)
            precondition(launcher.columns == columns)
            precondition(launcher.iconFrameSide == icon)
            precondition(launcher.labelSize == label)
            let occupied = CGFloat(columns) * icon + CGFloat(columns - 1) * 28 + launcher.horizontalInset * 2
            precondition(occupied <= size.width, "Launcher must fit \(profile)")
            print("PASS: \(profile.rawValue) \(Int(size.width))×\(Int(size.height)), \(columns) columns")
        }
    }
}
