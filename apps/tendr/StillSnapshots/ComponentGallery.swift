import SwiftUI
import XCTest
@testable import Still

/// Renders SwiftUI components straight to PNG with `ImageRenderer`, without launching the app UI.
///
/// A gallery is a comparison sheet: one row per variant, a light and a dark column. Each variant is
/// also written on its own as `<gallery>-<variant>.png`. Files go to `SNAPSHOT_DIR` (pass
/// `TEST_RUNNER_SNAPSHOT_DIR`; `scripts/capture-snapshots.sh` does) and are always attached to the
/// test result. Use synthetic fixture data only.
///
///     try ComponentGallery.render("upcoming-dates", width: 360, test: self) {
///         ComponentGallery.Variant("Three dates") { UpcomingDoseDates(dates: dates) }
///     }
///
/// Limits: `ImageRenderer` draws no UIKit-backed views (`List`, `TextField`, `Picker`, maps) and
/// renders iOS 26 Liquid Glass as a flat fill. Snapshot the row or card, not the screen.
@MainActor
enum ComponentGallery {
    struct Variant {
        let name: String
        let view: AnyView
        init(_ name: String, @ViewBuilder _ content: () -> some View) {
            self.name = name
            view = AnyView(content())
        }
    }

    @resultBuilder enum Builder {
        static func buildArray(_ groups: [[Variant]]) -> [Variant] { groups.flatMap { $0 } }
        static func buildExpression(_ variant: Variant) -> [Variant] { [variant] }
        static func buildBlock(_ groups: [Variant]...) -> [Variant] { groups.flatMap { $0 } }
    }

    static func render(_ gallery: String, width: CGFloat = 390, background: Color = Theme.background,
                       test: XCTestCase, @Builder variants: () -> [Variant]) throws {
        let variants = variants()
        XCTAssertFalse(variants.isEmpty, "\(gallery) has no variants")
        let sheet = VStack(alignment: .leading, spacing: 24) {
            Text(gallery).font(.title3.weight(.bold)).foregroundStyle(.black)
            ForEach(Array(variants.enumerated()), id: \.offset) { _, variant in
                pair(variant, width: width, background: background)
            }
        }.padding(24).background(Color(white: 0.9))
        try write(sheet, named: gallery, test: test)
        for variant in variants {
            try write(pair(variant, width: width, background: background).padding(16).background(Color(white: 0.9)),
                      named: "\(gallery)-\(slug(variant.name))", test: test)
        }
    }

    private static func pair(_ variant: Variant, width: CGFloat, background: Color) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(variant.name).font(.headline).foregroundStyle(.black)
            HStack(alignment: .top, spacing: 16) {
                ForEach([ColorScheme.light, .dark], id: \.self) { scheme in
                    variant.view
                        .padding(16)
                        .frame(width: width, alignment: .topLeading)
                        .background(background)
                        .environment(\.colorScheme, scheme)
                        .clipShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
                }
            }
        }
    }

    private static func write(_ view: some View, named name: String, test: XCTestCase) throws {
        let renderer = ImageRenderer(content: view)
        renderer.scale = 2
        let png = try XCTUnwrap(renderer.uiImage?.pngData(), "\(name) did not render")
        let attachment = XCTAttachment(data: png, uniformTypeIdentifier: "public.png")
        attachment.name = name
        attachment.lifetime = .keepAlways
        test.add(attachment)
        guard let directory = ProcessInfo.processInfo.environment["SNAPSHOT_DIR"], !directory.isEmpty else { return }
        let url = URL(fileURLWithPath: directory, isDirectory: true)
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        try png.write(to: url.appendingPathComponent("\(name).png"))
    }

    private static func slug(_ name: String) -> String {
        name.lowercased().map { $0.isLetter || $0.isNumber ? String($0) : "-" }.joined()
            .split(separator: "-").joined(separator: "-")
    }
}
