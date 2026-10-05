import Foundation

enum Format {
    static func time(_ seconds: Double) -> String {
        guard seconds.isFinite, seconds > 0 else { return "0:00" }
        let s = Int(seconds)
        let h = s / 3600, m = (s % 3600) / 60, r = s % 60
        return h > 0 ? String(format: "%d:%02d:%02d", h, m, r) : String(format: "%d:%02d", m, r)
    }

    static func time(_ seconds: Int?) -> String { time(Double(seconds ?? 0)) }

    static func longDuration(_ seconds: Int) -> String {
        let mins = Int((Double(seconds) / 60).rounded())
        if mins < 60 { return "\(mins) minute\(mins == 1 ? "" : "s")" }
        let h = mins / 60, m = mins % 60
        return "\(h) hour\(h == 1 ? "" : "s")" + (m > 0 ? ", \(m) minute\(m == 1 ? "" : "s")" : "")
    }

    static func count(_ n: Int, _ word: String) -> String {
        "\(n.formatted()) \(word)\(n == 1 ? "" : "s")"
    }

    private static let months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]

    static func releaseDate(_ album: Album) -> String? {
        let d = album.releaseDate ?? album.originalReleaseDate
        if let y = d?.year, let m = d?.month, let day = d?.day, (1...12).contains(m) {
            return "\(months[m - 1]) \(day), \(y)"
        }
        if let y = d?.year ?? album.year { return String(y) }
        return nil
    }

    static func stripHTML(_ html: String) -> String {
        var text = html.replacingOccurrences(of: "<[^>]+>", with: "", options: .regularExpression)
        if let range = text.range(of: "Read more on Last.fm", options: .caseInsensitive) {
            text = String(text[..<range.lowerBound])
        }
        return text.replacingOccurrences(of: "&amp;", with: "&")
            .replacingOccurrences(of: "&quot;", with: "\"")
            .replacingOccurrences(of: "&#39;", with: "'")
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }
}

enum Quality: String {
    case hiRes = "Hi-Res Lossless"
    case lossless = "Lossless"

    private static let losslessSuffixes: Set<String> = ["flac", "alac", "wav", "aiff", "aif", "ape", "wv", "dsf", "dff"]

    static func of(_ song: Song?) -> Quality? {
        guard let song else { return nil }
        let suffix = (song.suffix ?? "").lowercased()
        let lossless = losslessSuffixes.contains(suffix) || (suffix == "m4a" && (song.bitDepth ?? 0) > 0)
        guard lossless else { return nil }
        if (song.bitDepth ?? 0) > 16 || (song.samplingRate ?? 0) > 48000 { return .hiRes }
        return .lossless
    }

    static func of(album songs: [Song]) -> Quality? {
        let qualities = songs.map { of($0) }
        guard !qualities.isEmpty, qualities.allSatisfy({ $0 != nil }) else { return nil }
        return qualities.allSatisfy({ $0 == .hiRes }) ? .hiRes : .lossless
    }
}

extension String {
    /// Deterministic hue for genre tiles and placeholders.
    var stableHue: Double {
        var h: Int32 = 0
        for scalar in unicodeScalars { h = h &* 31 &+ Int32(truncatingIfNeeded: scalar.value) }
        return Double(abs(Int(h)) % 360) / 360
    }
}
