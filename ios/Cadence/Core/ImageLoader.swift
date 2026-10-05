import ImageIO
import SwiftUI
import UIKit

/// Loads cover art with a memory cache on top of URLCache, decoding and
/// downsampling off the main thread so scrolling stays smooth.
/// NSCache is thread-safe, so it can be read synchronously from any thread.
final class ImageMemoryCache: @unchecked Sendable {
    static let shared = ImageMemoryCache()
    let cache: NSCache<NSURL, UIImage> = {
        let c = NSCache<NSURL, UIImage>()
        c.totalCostLimit = 150 * 1024 * 1024
        return c
    }()
}

actor ImageLoader {
    static let shared = ImageLoader()

    private var inflight: [URL: Task<UIImage?, Never>] = [:]
    private let session: URLSession

    private init() {
        let config = URLSessionConfiguration.default
        config.urlCache = URLCache(memoryCapacity: 30 * 1024 * 1024, diskCapacity: 600 * 1024 * 1024)
        config.requestCachePolicy = .returnCacheDataElseLoad
        session = URLSession(configuration: config)
    }

    nonisolated func cached(_ url: URL) -> UIImage? {
        ImageMemoryCache.shared.cache.object(forKey: url as NSURL)
    }

    func image(for url: URL, maxPixel: CGFloat) async -> UIImage? {
        if let hit = cached(url) { return hit }
        if let running = inflight[url] { return await running.value }
        let session = self.session
        // Covers saved with downloads: used directly for small artwork, and as the
        // fallback when the server can't be reached (offline / away from home).
        let coverID = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.first { $0.name == "id" }?.value
        let localFile = coverID.map { DownloadManager.coverFile($0) }
        let task = Task<UIImage?, Never> {
            if let localFile, maxPixel <= 640, let data = try? Data(contentsOf: localFile),
               let image = Self.decode(data, maxPixel: maxPixel) {
                return image
            }
            let request = URLRequest(url: url, timeoutInterval: 10)
            if let result = try? await session.data(for: request), !result.0.isEmpty,
               let image = Self.decode(result.0, maxPixel: maxPixel) {
                return image
            }
            if let localFile, let data = try? Data(contentsOf: localFile) {
                return Self.decode(data, maxPixel: maxPixel)
            }
            return nil
        }
        inflight[url] = task
        let image = await task.value
        inflight[url] = nil
        if let image {
            let cost = Int(image.size.width * image.size.height * image.scale * image.scale * 4)
            ImageMemoryCache.shared.cache.setObject(image, forKey: url as NSURL, cost: cost)
        }
        return image
    }

    private static func decode(_ data: Data, maxPixel: CGFloat) -> UIImage? {
        guard let source = CGImageSourceCreateWithData(data as CFData, [kCGImageSourceShouldCache: false] as CFDictionary) else { return nil }
        let options: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceShouldCacheImmediately: true,
            kCGImageSourceThumbnailMaxPixelSize: max(64, maxPixel),
        ]
        guard let cg = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else { return nil }
        return UIImage(cgImage: cg)
    }
}

/// Fixed request sizes so Navidrome's resized-image cache and URLCache get reused.
enum ArtSize {
    static let buckets = [96, 160, 300, 450, 600, 900, 1200, 1600, 2400]

    /// Pixel size to request for artwork shown at `points`. "High" asks for twice
    /// the on-screen size, since Navidrome re-encodes resized covers at JPEG q75.
    static func pixels(for points: CGFloat, scale: CGFloat, quality: ArtworkQuality) -> Int {
        let want = points * scale * (quality == .standard ? 1 : 2)
        return buckets.first { CGFloat($0) >= want } ?? buckets.last!
    }
}

/// A small palette sampled from artwork, for backgrounds.
enum Palette {
    /// 3x3 grid of colours, row by row, tuned dark and saturated enough for white text.
    static func grid(from image: UIImage) -> [Color] {
        guard let cg = image.cgImage else { return [] }
        let n = 3
        var pixels = [UInt8](repeating: 0, count: n * n * 4)
        let drawn: Bool = pixels.withUnsafeMutableBytes { buffer in
            guard let ctx = CGContext(
                data: buffer.baseAddress, width: n, height: n, bitsPerComponent: 8, bytesPerRow: n * 4,
                space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
            ) else { return false }
            ctx.interpolationQuality = .medium
            ctx.draw(cg, in: CGRect(x: 0, y: 0, width: n, height: n))
            return true
        }
        guard drawn else { return [] }
        return (0..<(n * n)).map { i in
            let r = CGFloat(pixels[i * 4]) / 255, g = CGFloat(pixels[i * 4 + 1]) / 255, b = CGFloat(pixels[i * 4 + 2]) / 255
            var h: CGFloat = 0, s: CGFloat = 0, v: CGFloat = 0, a: CGFloat = 0
            UIColor(red: r, green: g, blue: b, alpha: 1).getHue(&h, saturation: &s, brightness: &v, alpha: &a)
            return Color(hue: Double(h), saturation: Double(min(1, s * 1.25)), brightness: Double(min(0.78, v * 0.85 + 0.05)))
        }
    }

    /// One dark, colourful tint for card backgrounds.
    static func tint(from image: UIImage) -> Color {
        let colors = grid(from: image)
        guard !colors.isEmpty else { return Color(white: 0.25) }
        // Pick the most saturated cell.
        let best = colors.max { saturation(of: $0) < saturation(of: $1) } ?? colors[4]
        return best
    }

    private static func saturation(of color: Color) -> CGFloat {
        var h: CGFloat = 0, s: CGFloat = 0, v: CGFloat = 0, a: CGFloat = 0
        UIColor(color).getHue(&h, saturation: &s, brightness: &v, alpha: &a)
        return s * v
    }
}
