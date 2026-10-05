import Foundation

struct LyricsLine: Identifiable, Hashable {
    let id: Int
    /// Seconds; -1 for unsynced lyrics.
    let time: Double
    let text: String
    /// An instrumental break, shown as "•••".
    var isGap = false
    var end: Double?
}

struct LyricsDoc: Hashable {
    var synced: Bool
    var lines: [LyricsLine]
    var source: String
}

/// Finds lyrics for a song: Navidrome's synced lyrics, then embedded LRC, then LRCLIB.
@MainActor
final class LyricsService {
    static let shared = LyricsService()
    private var cache: [String: LyricsDoc?] = [:]
    private static let gapSeconds = 4.0

    func lyrics(for song: Song) async -> LyricsDoc? {
        if let hit = cache[song.id] { return hit }
        let doc = await fetch(song)
        cache[song.id] = .some(doc)
        return doc
    }

    private func fetch(_ song: Song) async -> LyricsDoc? {
        guard let api = Session.shared.api else { return nil }
        var plain: (text: String, source: String)?

        if Session.shared.supportsSyncedLyrics, let list = try? await api.lyricsBySongID(song.id) {
            if let synced = list.first(where: { $0.synced && !($0.line ?? []).isEmpty }), let lines = synced.line {
                let offset = Double(synced.offset ?? 0) / 1000
                let timed = lines.map { (max(0, Double($0.start ?? 0) / 1000 - offset), $0.value.trimmingCharacters(in: .whitespaces)) }
                return LyricsDoc(synced: true, lines: Self.prepare(timed), source: "Navidrome")
            }
            if let flat = list.first(where: { !($0.line ?? []).isEmpty }), let lines = flat.line {
                plain = (lines.map(\.value).joined(separator: "\n"), "Navidrome")
            }
        }

        if plain == nil, let text = try? await api.lyrics(artist: song.artistName, title: song.title),
           !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            plain = (text, "Navidrome")
        }

        if let p = plain, Self.looksLikeLRC(p.text) {
            let parsed = Self.parseLRC(p.text)
            if !parsed.isEmpty { return LyricsDoc(synced: true, lines: Self.prepare(parsed), source: p.source) }
        }

        if AppSettings.shared.lrclib, let record = await lrclib(song) {
            if let synced = record.syncedLyrics, !synced.isEmpty {
                let parsed = Self.parseLRC(synced)
                if !parsed.isEmpty { return LyricsDoc(synced: true, lines: Self.prepare(parsed), source: "LRCLIB") }
            }
            if plain == nil, let text = record.plainLyrics, !text.isEmpty { plain = (text, "LRCLIB") }
        }

        guard let plain else { return nil }
        let lines = plain.text.components(separatedBy: .newlines).enumerated().map {
            LyricsLine(id: $0.offset, time: -1, text: $0.element.trimmingCharacters(in: .whitespaces))
        }
        return LyricsDoc(synced: false, lines: lines, source: plain.source)
    }

    // MARK: LRCLIB

    private struct LrclibRecord: Decodable {
        var syncedLyrics: String?
        var plainLyrics: String?
        var duration: Double?
    }

    private func lrclib(_ song: Song) async -> LrclibRecord? {
        var get = URLComponents(string: "https://lrclib.net/api/get")!
        get.queryItems = [
            URLQueryItem(name: "track_name", value: song.title),
            URLQueryItem(name: "artist_name", value: song.artistName),
            URLQueryItem(name: "album_name", value: song.album),
            URLQueryItem(name: "duration", value: song.duration.map(String.init)),
        ].filter { $0.value != nil }
        if let record: LrclibRecord = await fetchJSON(get.url) { return record }

        var search = URLComponents(string: "https://lrclib.net/api/search")!
        search.queryItems = [URLQueryItem(name: "track_name", value: song.title), URLQueryItem(name: "artist_name", value: song.artistName)]
        guard let results: [LrclibRecord] = await fetchJSON(search.url) else { return nil }
        let close = results.filter { r in
            guard let want = song.duration, let have = r.duration else { return true }
            return abs(have - Double(want)) < 4
        }
        return close.first { $0.syncedLyrics != nil } ?? close.first { $0.plainLyrics != nil }
    }

    private func fetchJSON<T: Decodable>(_ url: URL?) async -> T? {
        guard let url else { return nil }
        var request = URLRequest(url: url, timeoutInterval: 15)
        request.setValue("Cadence for iOS (Navidrome client)", forHTTPHeaderField: "User-Agent")
        guard let result = try? await URLSession.shared.data(for: request),
              (result.1 as? HTTPURLResponse)?.statusCode == 200 else { return nil }
        return try? JSONDecoder().decode(T.self, from: result.0)
    }

    // MARK: parsing

    static func looksLikeLRC(_ text: String) -> Bool {
        text.range(of: #"(?m)^\s*\[\d{1,3}:\d{1,2}([.:]\d{1,3})?\]"#, options: .regularExpression) != nil
    }

    static func parseLRC(_ text: String) -> [(Double, String)] {
        var out: [(Double, String)] = []
        var offset = 0.0
        let timeRegex = try! NSRegularExpression(pattern: #"\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]"#)
        let wordTimes = try! NSRegularExpression(pattern: #"<\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?>"#)
        for raw in text.components(separatedBy: .newlines) {
            let ns = raw as NSString
            if raw.lowercased().hasPrefix("[offset:") {
                let value = raw.dropFirst(8).prefix { $0 != "]" }.trimmingCharacters(in: .whitespaces)
                offset = (Double(value) ?? 0) / 1000
                continue
            }
            let matches = timeRegex.matches(in: raw, range: NSRange(location: 0, length: ns.length))
            guard let last = matches.last, matches.first?.range.location == raw.prefix(while: { $0 == " " }).utf16.count else { continue }
            var lyric = ns.substring(from: last.range.location + last.range.length)
            lyric = wordTimes.stringByReplacingMatches(in: lyric, range: NSRange(location: 0, length: (lyric as NSString).length), withTemplate: "")
                .trimmingCharacters(in: .whitespaces)
            for m in matches {
                let minutes = Double(ns.substring(with: m.range(at: 1))) ?? 0
                let seconds = Double(ns.substring(with: m.range(at: 2))) ?? 0
                var fraction = 0.0
                if m.range(at: 3).location != NSNotFound {
                    let digits = ns.substring(with: m.range(at: 3))
                    fraction = (Double(digits) ?? 0) / pow(10, Double(digits.count))
                }
                out.append((max(0, minutes * 60 + seconds + fraction - offset), lyric))
            }
        }
        return out.sorted { $0.0 < $1.0 }
    }

    /// Adds "•••" lines for an intro and long instrumental breaks, drops other empty lines.
    static func prepare(_ timed: [(Double, String)]) -> [LyricsLine] {
        var lines: [LyricsLine] = []
        if let first = timed.first, first.0 > gapSeconds {
            lines.append(LyricsLine(id: 0, time: 0, text: "", isGap: true, end: first.0))
        }
        for (i, entry) in timed.enumerated() {
            let next = i + 1 < timed.count ? timed[i + 1].0 : nil
            if entry.1.isEmpty {
                if let next, next - entry.0 >= gapSeconds {
                    lines.append(LyricsLine(id: lines.count, time: entry.0, text: "", isGap: true, end: next))
                }
                continue
            }
            lines.append(LyricsLine(id: lines.count, time: entry.0, text: entry.1))
        }
        return lines
    }
}
