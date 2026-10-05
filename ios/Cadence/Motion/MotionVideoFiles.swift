import AVFoundation
import UIKit

/// Turns Apple Music's streamed (HLS) motion artwork into local video files,
/// which is what the lock screen's animated artwork requires.
///
/// Each HLS rendition of an animated cover is a single fragmented MP4 that the
/// playlist addresses with byte ranges, so downloading that one file gives a
/// complete, playable video. Files are cached, so each cover downloads once.
actor MotionVideoFiles {
    static let shared = MotionVideoFiles()

    private var inflight: [String: Task<URL?, Never>] = [:]
    private var previews: [String: UIImage] = [:]
    private static let maxCachedFiles = 80

    private static var directory: URL {
        let dir = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("MotionVideos", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    private static func file(for id: String) -> URL {
        let safe = String(id.map { $0.isLetter || $0.isNumber || $0 == "-" || $0 == "_" ? $0 : "_" })
        return directory.appendingPathComponent(safe + ".mp4")
    }

    /// A local file for the given HLS animated cover, downloading it if needed.
    func localFile(for hls: URL, id: String) async -> URL? {
        let destination = Self.file(for: id)
        if FileManager.default.fileExists(atPath: destination.path) { return destination }
        if let running = inflight[id] { return await running.value }
        let task = Task<URL?, Never> {
            do {
                try await Self.download(hls, to: destination)
                return destination
            } catch {
                return nil
            }
        }
        inflight[id] = task
        let result = await task.value
        inflight[id] = nil
        if result != nil { Self.prune() }
        return result
    }

    /// The preview frame for an animated cover with the given aspect ratio (width / height):
    /// the video's first frame when it's already downloaded, otherwise the static
    /// cover cropped to the right shape.
    func preview(id: String, fallback: UIImage?, aspect: CGFloat) async -> UIImage? {
        if let hit = previews[id] { return hit }
        let file = Self.file(for: id)
        if FileManager.default.fileExists(atPath: file.path),
           let frame = await Self.firstFrame(of: file) {
            let image = Self.crop(frame, to: aspect)
            previews[id] = image
            return image
        }
        return fallback.map { Self.crop($0, to: aspect) }
    }

    // MARK: download

    private static func text(_ url: URL) async throws -> String {
        let (data, response) = try await URLSession.shared.data(from: url)
        guard (response as? HTTPURLResponse)?.statusCode == 200 else { throw URLError(.badServerResponse) }
        return String(decoding: data, as: UTF8.self)
    }

    private static func download(_ master: URL, to destination: URL) async throws {
        let masterText = try await text(master)
        // A master playlist lists renditions; a media playlist lists segments directly.
        let mediaURL = masterText.contains("#EXT-X-STREAM-INF") ? (bestVariant(in: masterText, base: master) ?? master) : master
        let mediaText: String
        if mediaURL == master {
            mediaText = masterText
        } else {
            mediaText = try await text(mediaURL)
        }
        let pieces = segments(in: mediaText, base: mediaURL)
        guard !pieces.isEmpty else { throw URLError(.cannotParseResponse) }

        let temp = destination.appendingPathExtension("part")
        try? FileManager.default.removeItem(at: temp)
        if Set(pieces.map(\.url)).count == 1 {
            // Every segment is a byte range of one file: fetch it whole.
            let (downloaded, response) = try await URLSession.shared.download(from: pieces[0].url)
            guard (response as? HTTPURLResponse)?.statusCode == 200 else { throw URLError(.badServerResponse) }
            try FileManager.default.moveItem(at: downloaded, to: temp)
        } else {
            // Separate segment files: concatenate init segment + fragments.
            var data = Data()
            for piece in pieces {
                var request = URLRequest(url: piece.url)
                if let range = piece.range {
                    request.setValue("bytes=\(range.lowerBound)-\(range.upperBound)", forHTTPHeaderField: "Range")
                }
                let (chunk, _) = try await URLSession.shared.data(for: request)
                data.append(chunk)
            }
            try data.write(to: temp)
        }
        try? FileManager.default.removeItem(at: destination)
        try FileManager.default.moveItem(at: temp, to: destination)
    }

    /// Picks the sharpest SDR rendition that isn't wastefully large for a phone screen.
    private static func bestVariant(in master: String, base: URL) -> URL? {
        struct Variant { var url: URL; var width: Int; var height: Int; var hdr: Bool }
        var variants: [Variant] = []
        let lines = master.components(separatedBy: .newlines)
        for (i, line) in lines.enumerated() where line.hasPrefix("#EXT-X-STREAM-INF:") {
            guard i + 1 < lines.count else { continue }
            let uri = lines[i + 1].trimmingCharacters(in: .whitespaces)
            guard !uri.isEmpty, !uri.hasPrefix("#"), let url = URL(string: uri, relativeTo: base)?.absoluteURL else { continue }
            var width = 0, height = 0
            if let range = line.range(of: #"RESOLUTION=(\d+)x(\d+)"#, options: .regularExpression) {
                let parts = line[range].dropFirst("RESOLUTION=".count).split(separator: "x")
                width = Int(parts.first ?? "") ?? 0
                height = Int(parts.last ?? "") ?? 0
            }
            let hdr = line.contains("VIDEO-RANGE=PQ") || line.contains("VIDEO-RANGE=HLG")
            variants.append(Variant(url: url, width: width, height: height, hdr: hdr))
        }
        let sdr = variants.filter { !$0.hdr }
        let pool = sdr.isEmpty ? variants : sdr
        let fitting = pool.filter { max($0.width, $0.height) <= 1600 }
        let choice = fitting.max { $0.width * $0.height < $1.width * $1.height }
            ?? pool.min { $0.width * $0.height < $1.width * $1.height }
        return choice?.url
    }

    private struct Piece { var url: URL; var range: ClosedRange<Int>? }

    /// The init segment and media segments of a media playlist, in order.
    private static func segments(in playlist: String, base: URL) -> [Piece] {
        var pieces: [Piece] = []
        var pendingRange: (length: Int, offset: Int?)?
        var nextOffset: [URL: Int] = [:]

        func range(for url: URL, _ spec: (length: Int, offset: Int?)?) -> ClosedRange<Int>? {
            guard let spec else { return nil }
            let start = spec.offset ?? nextOffset[url] ?? 0
            nextOffset[url] = start + spec.length
            return start...(start + spec.length - 1)
        }

        func parseRange(_ text: Substring) -> (length: Int, offset: Int?)? {
            let parts = text.split(separator: "@")
            guard let length = Int(parts.first ?? "") else { return nil }
            return (length, parts.count > 1 ? Int(parts[1]) : nil)
        }

        for raw in playlist.components(separatedBy: .newlines) {
            let line = raw.trimmingCharacters(in: .whitespaces)
            if line.hasPrefix("#EXT-X-MAP:") {
                guard let uriRange = line.range(of: #"URI="[^"]+""#, options: .regularExpression),
                      let url = URL(string: String(line[uriRange].dropFirst(5).dropLast()), relativeTo: base)?.absoluteURL else { continue }
                var spec: (length: Int, offset: Int?)?
                if let r = line.range(of: #"BYTERANGE="[^"]+""#, options: .regularExpression) {
                    spec = parseRange(line[r].dropFirst(11).dropLast())
                }
                pieces.append(Piece(url: url, range: range(for: url, spec)))
            } else if line.hasPrefix("#EXT-X-BYTERANGE:") {
                pendingRange = parseRange(line.dropFirst("#EXT-X-BYTERANGE:".count))
            } else if !line.isEmpty, !line.hasPrefix("#") {
                guard let url = URL(string: line, relativeTo: base)?.absoluteURL else { continue }
                pieces.append(Piece(url: url, range: range(for: url, pendingRange)))
                pendingRange = nil
            }
        }
        return pieces
    }

    // MARK: images

    private static func firstFrame(of file: URL) async -> UIImage? {
        let generator = AVAssetImageGenerator(asset: AVURLAsset(url: file))
        generator.appliesPreferredTrackTransform = true
        generator.maximumSize = CGSize(width: 1200, height: 1200)
        guard let result = try? await generator.image(at: .zero) else { return nil }
        return UIImage(cgImage: result.image)
    }

    /// Centre-crops an image to the given aspect ratio (width / height).
    private static func crop(_ image: UIImage, to aspect: CGFloat) -> UIImage {
        guard let cg = image.cgImage else { return image }
        let w = CGFloat(cg.width), h = CGFloat(cg.height)
        guard w > 0, h > 0, abs(w / h - aspect) > 0.01 else { return image }
        let rect: CGRect = w / h > aspect
            ? CGRect(x: (w - h * aspect) / 2, y: 0, width: h * aspect, height: h)
            : CGRect(x: 0, y: (h - w / aspect) / 2, width: w, height: w / aspect)
        guard let cropped = cg.cropping(to: rect.integral) else { return image }
        return UIImage(cgImage: cropped, scale: image.scale, orientation: image.imageOrientation)
    }

    /// Keeps the cache bounded: removes the oldest videos beyond the limit.
    private static func prune() {
        let fm = FileManager.default
        guard let files = try? fm.contentsOfDirectory(at: directory, includingPropertiesForKeys: [.contentModificationDateKey]),
              files.count > maxCachedFiles else { return }
        let sorted = files.sorted {
            let a = (try? $0.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? .distantPast
            let b = (try? $1.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? .distantPast
            return a < b
        }
        for file in sorted.prefix(files.count - maxCachedFiles) { try? fm.removeItem(at: file) }
    }
}
