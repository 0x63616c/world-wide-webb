import UIKit

/// One portable JPEG: native and web galleries can both display the finished strip.
enum PhotoBoothStrip {
    enum Failure: Error { case needsFourPhotos, invalidImage }

    static func render(_ frames: [Data]) throws -> Data {
        guard frames.count == 4 else { throw Failure.needsFourPhotos }
        let images = try frames.map { data in
            guard let image = UIImage(data: data), image.size.width > 0, image.size.height > 0 else {
                throw Failure.invalidImage
            }
            return image
        }
        // Pixel dimensions, independent of the display's Retina scale; below ingest's 4 MiB cap.
        let size = CGSize(width: 640, height: 1888)
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        format.opaque = true
        return UIGraphicsImageRenderer(size: size, format: format).jpegData(withCompressionQuality: 0.9) { context in
            UIColor.white.setFill()
            context.fill(CGRect(origin: .zero, size: size))
            for (index, image) in images.enumerated() {
                let cell = CGRect(x: 20, y: 20 + CGFloat(index) * 466, width: 600, height: 450)
                let scale = max(cell.width / image.size.width, cell.height / image.size.height)
                let drawn = CGSize(width: image.size.width * scale, height: image.size.height * scale)
                context.cgContext.saveGState()
                context.cgContext.clip(to: cell)
                image.draw(
                    in: CGRect(
                        x: cell.midX - drawn.width / 2, y: cell.midY - drawn.height / 2,
                        width: drawn.width, height: drawn.height))
                context.cgContext.restoreGState()
            }
        }
    }
}
