import CoreImage
import XCTest
@testable import WorldWideWebb

final class WifiQRCodeTests: XCTestCase {
    func testSecuredPayloadUsesFixtureValues() {
        XCTAssertEqual(WifiQRCode.payload(for: WifiState()), "WIFI:T:WPA;S:WWW-Guest;P:fixture-password-123;;")
    }

    func testEscapesEveryReservedCharacterInBothFields() {
        let wifi = WifiState(ssid: #"a\b;c,d:e"f"#, password: #"p\q;r,s:t"u"#)
        XCTAssertEqual(WifiQRCode.payload(for: wifi), #"WIFI:T:WPA;S:a\\b\;c\,d\:e\"f;P:p\\q\;r\,s\:t\"u;;"#)
    }

    func testOpenAndUnconfiguredNetworks() {
        XCTAssertEqual(WifiQRCode.payload(for: .open), "WIFI:T:nopass;S:WWW-Guest;;")
        XCTAssertEqual(WifiQRCode.payload(for: WifiState(ssid: "Guest;Open", password: "")), #"WIFI:T:nopass;S:Guest\;Open;;"#)
        XCTAssertNil(WifiQRCode.payload(for: .unconfigured))
        XCTAssertNil(WifiQRCode.payload(for: WifiState(ssid: "", password: "unused")))
        XCTAssertNil(WifiQRCode.render(.unconfigured))
    }

    func testRenderedCodesDecodeToTheirPayloads() throws {
        let detector = try XCTUnwrap(CIDetector(ofType: CIDetectorTypeQRCode, context: CIContext(), options: [CIDetectorAccuracy: CIDetectorAccuracyHigh]))
        for wifi in [WifiState(), .open, WifiState(ssid: #"Café;Guest\""#, password: #"test:,;\""#)] {
            let image = try XCTUnwrap(WifiQRCode.render(wifi))
            XCTAssertEqual(image.width, image.height)
            let enlarged = CIImage(cgImage: image).transformed(by: CGAffineTransform(scaleX: 10, y: 10))
            let feature = try XCTUnwrap(detector.features(in: enlarged).first as? CIQRCodeFeature)
            XCTAssertEqual(feature.messageString, WifiQRCode.payload(for: wifi))
        }
    }
}
