import Foundation

/// Animated ("motion") album artwork from the Apple Music catalog. Mirrors the
/// desktop app: uses a pasted token or the token built into Apple's web player
/// (fetched from music.apple.com and refreshed when it expires), finds the
/// matching catalog album, and returns the HLS URL of its `editorialVideo`.
actor MotionService {
    static let shared = MotionService()

    struct Config: Sendable, Hashable {
        var autoToken: Bool
        var token: String
        var storefront: String

        var signature: String { "v3|\(autoToken ? "auto" : token)|\(storefront)" }
    }

    private static let webAPI = "https://amp-api.music.apple.com/v1"
    private static let developerAPI = "https://api.music.apple.com/v1"
    private static let webOrigin = "https://music.apple.com"
    private static let webPage = "https://music.apple.com/us/browse"
    private static let browserUA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15"
    private static let tokenKey = "motion.webToken"
    private static let cacheKey = "motion.cache"
    private static let videoKeys = ["motionDetailSquare", "motionSquareVideo1x1", "motionDetailTall", "motionTallVideo3x4"]

    private var webToken: String? = UserDefaults.standard.string(forKey: MotionService.tokenKey)

    // MARK: public

    func videoURL(albumID: String, album: String, artist: String, config: Config) async -> URL? {
        let key = "\(config.signature)|\(albumID)"
        if let hit = cached(key) { return hit.url }
        do {
            let url = try await lookup(album: album, artist: artist, config: config)
            store(key, url)
            return url
        } catch {
            return nil
        }
    }

    struct TestResult: Sendable {
        var ok: Bool
        var message: String
    }

    func test(config: Config) async -> TestResult {
        do {
            for (artist, album) in [("Billie Eilish", "Hit Me Hard and Soft"), ("Taylor Swift", "Midnights"), ("The Weeknd", "After Hours")] {
                if try await lookup(album: album, artist: artist, config: config) != nil {
                    return TestResult(ok: true, message: "Working — Apple is returning animated artwork.")
                }
            }
            return TestResult(ok: false, message: "The token works, but Apple didn't return animated artwork for the test albums.")
        } catch {
            return TestResult(ok: false, message: error.localizedDescription)
        }
    }

    func clearCache() {
        UserDefaults.standard.removeObject(forKey: Self.cacheKey)
    }

    // MARK: lookup

    private struct API {
        var token: String
        var base: String
        var origin: String?
        var auto: Bool
    }

    private struct AuthError: LocalizedError {
        var errorDescription: String? { "Apple Music rejected the token." }
    }

    private func api(for config: Config, forceRefresh: Bool = false) async throws -> API {
        if config.autoToken {
            let token = try await currentWebToken(forceRefresh: forceRefresh)
            return API(token: token, base: Self.webAPI, origin: Self.webOrigin, auto: true)
        }
        var token = config.token.trimmingCharacters(in: .whitespacesAndNewlines.union(CharacterSet(charactersIn: "\"")))
        if token.hasPrefix("Bearer ") { token = String(token.dropFirst(7)) }
        guard !token.isEmpty else { throw MotionError("Paste a token or turn on “Get token from music.apple.com”.") }
        let web = Self.isWebPlayerToken(token)
        return API(token: token, base: web ? Self.webAPI : Self.developerAPI, origin: web ? Self.webOrigin : nil, auto: false)
    }

    private func lookup(album: String, artist: String, config: Config) async throws -> URL? {
        let client = try await self.api(for: config)
        do {
            return try await lookup(api: client, album: album, artist: artist, storefront: config.storefront)
        } catch is AuthError where client.auto {
            let refreshed = try await self.api(for: config, forceRefresh: true)
            return try await lookup(api: refreshed, album: album, artist: artist, storefront: config.storefront)
        }
    }

    private func lookup(api: API, album: String, artist: String, storefront: String) async throws -> URL? {
        let sf = storefront.isEmpty ? "us" : storefront.lowercased()
        let term = "\(Self.words(artist).joined(separator: " ")) \(Self.splitTitle(album).base)"
        var search = URLComponents(string: "\(api.base)/catalog/\(sf)/search")!
        search.queryItems = [URLQueryItem(name: "term", value: term), URLQueryItem(name: "types", value: "albums"), URLQueryItem(name: "limit", value: "15")]
        let results = try await getJSON(search.url!, api: api)
        let data = ((results["results"] as? [String: Any])?["albums"] as? [String: Any])?["data"] as? [[String: Any]] ?? []

        struct Candidate { var id: String; var score: Int; var clean: Bool }
        var candidates: [Candidate] = data.compactMap { item in
            guard let id = item["id"] as? String, let attrs = item["attributes"] as? [String: Any] else { return nil }
            let title = Self.albumMatch(attrs["name"] as? String ?? "", album)
            let by = Self.artistMatch(attrs["artistName"] as? String ?? "", artist)
            guard title >= 3, by >= 2 else { return nil }
            return Candidate(id: id, score: title + by, clean: (attrs["contentRating"] as? String) == "clean")
        }
        // Best first; among equals, non-clean editions first, then Apple's ranking (stable sort).
        candidates = candidates.enumerated()
            .sorted { a, b in
                if a.element.score != b.element.score { return a.element.score > b.element.score }
                if a.element.clean != b.element.clean { return !a.element.clean }
                return a.offset < b.offset
            }
            .map(\.element)
        let ids = candidates.prefix(5).map(\.id)
        guard !ids.isEmpty else { return nil }

        var albums = URLComponents(string: "\(api.base)/catalog/\(sf)/albums")!
        albums.queryItems = [URLQueryItem(name: "ids", value: ids.joined(separator: ",")), URLQueryItem(name: "extend", value: "editorialVideo")]
        let json = try await getJSON(albums.url!, api: api)
        let entries = json["data"] as? [[String: Any]] ?? []
        for id in ids {
            guard let entry = entries.first(where: { ($0["id"] as? String) == id }),
                  let video = (entry["attributes"] as? [String: Any])?["editorialVideo"] as? [String: Any] else { continue }
            for key in Self.videoKeys {
                if let urlString = (video[key] as? [String: Any])?["video"] as? String, let url = URL(string: urlString) {
                    return url
                }
            }
        }
        return nil
    }

    private func getJSON(_ url: URL, api: API) async throws -> [String: Any] {
        var request = URLRequest(url: url, timeoutInterval: 20)
        request.setValue("Bearer \(api.token)", forHTTPHeaderField: "Authorization")
        if let origin = api.origin { request.setValue(origin, forHTTPHeaderField: "Origin") }
        let (data, response) = try await URLSession.shared.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        if status == 401 || status == 403 { throw AuthError() }
        guard (200..<300).contains(status) else { throw MotionError("Apple Music API error (\(status)).") }
        return (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
    }

    // MARK: web-player token

    private func currentWebToken(forceRefresh: Bool) async throws -> String {
        if !forceRefresh, let token = webToken, let exp = Self.claims(token)?["exp"] as? Double,
           exp > Date().timeIntervalSince1970 + 86_400 {
            return token
        }
        let fresh = try await scrapeWebToken()
        webToken = fresh
        UserDefaults.standard.set(fresh, forKey: Self.tokenKey)
        return fresh
    }

    private func scrapeWebToken() async throws -> String {
        let html = try await fetchText(Self.webPage)
        let regex = try NSRegularExpression(pattern: #"src="(/assets/[^"]+\.js)""#)
        let ns = html as NSString
        var scripts = regex.matches(in: html, range: NSRange(location: 0, length: ns.length)).map { ns.substring(with: $0.range(at: 1)) }
        scripts.sort { a, b in
            let ka = (a.contains("legacy") ? 1 : 0, a.contains("index") ? 0 : 1)
            let kb = (b.contains("legacy") ? 1 : 0, b.contains("index") ? 0 : 1)
            return ka < kb
        }
        for src in scripts.prefix(6) {
            guard let js = try? await fetchText(Self.webOrigin + src) else { continue }
            if let token = Self.findWebToken(in: js) { return token }
        }
        throw MotionError("Couldn't find a token on music.apple.com — Apple may have changed their site.")
    }

    private func fetchText(_ urlString: String) async throws -> String {
        var request = URLRequest(url: URL(string: urlString)!, timeoutInterval: 30)
        request.setValue(Self.browserUA, forHTTPHeaderField: "User-Agent")
        let (data, response) = try await URLSession.shared.data(for: request)
        guard (response as? HTTPURLResponse)?.statusCode == 200 else { throw MotionError("Couldn't load music.apple.com.") }
        return String(decoding: data, as: UTF8.self)
    }

    static func findWebToken(in text: String) -> String? {
        guard let regex = try? NSRegularExpression(pattern: #"eyJ[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+"#) else { return nil }
        let ns = text as NSString
        var fallback: String?
        for match in regex.matches(in: text, range: NSRange(location: 0, length: ns.length)) {
            let candidate = ns.substring(with: match.range)
            guard let claims = claims(candidate) else { continue }
            if claims["iss"] as? String == "AMPWebPlay" { return candidate }
            if fallback == nil, claims["root_https_origin"] != nil { fallback = candidate }
        }
        return fallback
    }

    static func claims(_ token: String) -> [String: Any]? {
        let parts = token.split(separator: ".")
        guard parts.count == 3 else { return nil }
        var payload = String(parts[1]).replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        while payload.count % 4 != 0 { payload += "=" }
        guard let data = Data(base64Encoded: payload) else { return nil }
        return (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
    }

    static func isWebPlayerToken(_ token: String) -> Bool {
        guard let c = claims(token) else { return false }
        return c["iss"] as? String == "AMPWebPlay" || c["root_https_origin"] != nil
    }

    // MARK: matching (same rules as the desktop app)

    private static let differentRecording: Set<String> = [
        "remix", "remixes", "remixed", "mix", "live", "acoustic", "instrumental", "instrumentals",
        "karaoke", "sped", "slowed", "reverb", "demo", "demos", "commentary", "acapella", "cappella",
        "unplugged", "orchestral", "reimagined", "rework", "reworks", "edit", "edits",
    ]

    static func words(_ s: String) -> [String] {
        s.lowercased()
            .map { $0.isLetter || $0.isNumber ? $0 : " " }
            .reduce(into: "") { $0.append($1) }
            .split(separator: " ")
            .map(String.init)
    }

    /// "to hell with it (Remixes)" -> ("to hell with it", ["remixes"]); "Album - EP" -> ("album", ["ep"]).
    static func splitTitle(_ s: String) -> (base: String, extra: [String]) {
        var base = "", extra = ""
        var depth = 0
        for c in s {
            switch c {
            case "(", "[": depth += 1; extra.append(" ")
            case ")", "]": depth = max(0, depth - 1)
            default: if depth > 0 { extra.append(c) } else { base.append(c) }
            }
        }
        if let range = base.range(of: " - ", options: .backwards) {
            extra += " " + base[range.upperBound...]
            base = String(base[..<range.lowerBound])
        }
        return (words(base).joined(separator: " "), words(extra))
    }

    /// 4 = identical, 3 = same release in another edition, 0 = different recording or unrelated.
    static func albumMatch(_ candidate: String, _ wanted: String) -> Int {
        let (cb, cx) = splitTitle(candidate)
        let (wb, wx) = splitTitle(wanted)
        guard !cb.isEmpty, cb == wb else { return 0 }
        let added = cx.filter { !wx.contains($0) }
        let removed = wx.filter { !cx.contains($0) }
        if added.isEmpty && removed.isEmpty { return 4 }
        let differs = (added + removed).contains(where: { differentRecording.contains($0) })
        return differs ? 0 : 3
    }

    static func artistMatch(_ candidate: String, _ wanted: String) -> Int {
        let c = words(candidate).joined(separator: " "), w = words(wanted).joined(separator: " ")
        if c.isEmpty || w.isEmpty { return 0 }
        if c == w { return 3 }
        return c.contains(w) || w.contains(c) ? 2 : 0
    }

    // MARK: cache

    private struct Entry: Codable {
        var url: URL?
        var time: Double
    }

    private func cached(_ key: String) -> Entry? {
        guard let data = UserDefaults.standard.data(forKey: Self.cacheKey),
              let all = try? JSONDecoder().decode([String: Entry].self, from: data),
              let hit = all[key] else { return nil }
        let age = Date().timeIntervalSince1970 - hit.time
        return age < (hit.url == nil ? 3 : 14) * 86_400 ? hit : nil
    }

    private func store(_ key: String, _ url: URL?) {
        var all: [String: Entry] = [:]
        if let data = UserDefaults.standard.data(forKey: Self.cacheKey) {
            all = (try? JSONDecoder().decode([String: Entry].self, from: data)) ?? [:]
        }
        all[key] = Entry(url: url, time: Date().timeIntervalSince1970)
        if let data = try? JSONEncoder().encode(all) {
            UserDefaults.standard.set(data, forKey: Self.cacheKey)
        }
    }
}

struct MotionError: LocalizedError {
    var message: String
    init(_ message: String) { self.message = message }
    var errorDescription: String? { message }
}
