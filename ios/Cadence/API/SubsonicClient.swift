import CryptoKit
import Foundation

struct Credentials: Codable, Equatable {
    var server: URL
    var username: String
    var salt: String
    var token: String
}

struct SubsonicError: LocalizedError {
    var code: Int?
    var message: String
    var errorDescription: String? { message }
}

/// Talks to a Navidrome server over the Subsonic API (JSON). Token auth with a
/// salt that is fixed per sign-in, so cover/stream URLs stay stable and cacheable.
final class SubsonicClient: Sendable {
    static let clientName = "Cadence"
    static let apiVersion = "1.16.1"

    let creds: Credentials
    private let authItems: [URLQueryItem]

    init(creds: Credentials) {
        self.creds = creds
        authItems = [
            URLQueryItem(name: "u", value: creds.username),
            URLQueryItem(name: "t", value: creds.token),
            URLQueryItem(name: "s", value: creds.salt),
            URLQueryItem(name: "v", value: Self.apiVersion),
            URLQueryItem(name: "c", value: Self.clientName),
        ]
    }

    // MARK: sign in

    static func normalizeServer(_ input: String) -> URL? {
        var text = input.trimmingCharacters(in: .whitespacesAndNewlines)
        if !text.lowercased().hasPrefix("http://") && !text.lowercased().hasPrefix("https://") {
            text = "http://" + text
        }
        while text.hasSuffix("/") { text.removeLast() }
        return URL(string: text)
    }

    static func signIn(server: String, username: String, password: String) async throws -> (SubsonicClient, SubsonicResponse) {
        guard let url = normalizeServer(server) else { throw SubsonicError(message: "That server address doesn't look right.") }
        let salt = randomSalt()
        let token = md5Hex(password + salt)
        let client = SubsonicClient(creds: Credentials(server: url, username: username.trimmingCharacters(in: .whitespaces), salt: salt, token: token))
        let info = try await client.get("ping")
        return (client, info)
    }

    private static func randomSalt() -> String {
        (0..<8).map { _ in String(format: "%02x", UInt8.random(in: 0...255)) }.joined()
    }

    private static func md5Hex(_ text: String) -> String {
        Insecure.MD5.hash(data: Data(text.utf8)).map { String(format: "%02x", $0) }.joined()
    }

    // MARK: URLs

    func url(_ endpoint: String, _ params: [(String, String?)] = []) -> URL {
        var comps = URLComponents(url: creds.server.appendingPathComponent("rest/\(endpoint)"), resolvingAgainstBaseURL: false)!
        var items = authItems
        for (key, value) in params {
            if let value { items.append(URLQueryItem(name: key, value: value)) }
        }
        // "+" is legal in a query but servers read it as a space; encode it explicitly.
        comps.percentEncodedQueryItems = items.map {
            URLQueryItem(name: $0.name, value: $0.value?.addingPercentEncoding(withAllowedCharacters: Self.queryAllowed))
        }
        return comps.url!
    }

    private static let queryAllowed: CharacterSet = {
        var set = CharacterSet.urlQueryAllowed
        set.remove(charactersIn: "+&=?#")
        return set
    }()

    func coverURL(_ id: String?, size: Int?) -> URL? {
        guard let id, !id.isEmpty else { return nil }
        return url("getCoverArt", [("id", id), ("size", size.map(String.init))])
    }

    func streamURL(songID: String, format: String?, maxBitRate: Int?) -> URL {
        let transcoding = (format != nil && format != "raw") || (maxBitRate ?? 0) > 0
        return url("stream", [
            ("id", songID),
            ("format", transcoding ? (format == "raw" ? nil : format) : "raw"),
            ("maxBitRate", (maxBitRate ?? 0) > 0 ? String(maxBitRate!) : nil),
            ("estimateContentLength", transcoding ? "true" : nil),
        ])
    }

    // MARK: request

    @discardableResult
    func get(_ endpoint: String, _ params: [(String, String?)] = []) async throws -> SubsonicResponse {
        let request = URLRequest(url: url(endpoint, params + [("f", "json")]), timeoutInterval: 30)
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await URLSession.shared.data(for: request)
        } catch {
            if (error as? URLError)?.code == .cancelled { throw error }
            throw SubsonicError(message: "Can't reach \(creds.server.host() ?? "the server"). Check the address and your connection.")
        }
        if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
            throw SubsonicError(code: http.statusCode, message: "The server responded with \(http.statusCode).")
        }
        let root: SubsonicRoot
        do {
            root = try JSONDecoder().decode(SubsonicRoot.self, from: data)
        } catch {
            throw SubsonicError(message: "That doesn't look like a Navidrome server.")
        }
        if root.response.status != "ok" {
            throw SubsonicError(code: root.response.error?.code, message: root.response.error?.message ?? "Request failed.")
        }
        return root.response
    }

    // MARK: endpoints

    func extensions() async -> [String] {
        (try? await get("getOpenSubsonicExtensions").openSubsonicExtensions?.map(\.name)) ?? []
    }

    func albumList(_ type: AlbumListType, size: Int = 40, offset: Int = 0, genre: String? = nil) async throws -> [Album] {
        var params: [(String, String?)] = [("type", type.rawValue), ("size", String(size)), ("offset", String(offset))]
        if type == .byYear { params += [("fromYear", "3000"), ("toYear", "0")] }
        if let genre { params.append(("genre", genre)) }
        return try await get("getAlbumList2", params).albumList2?.album ?? []
    }

    func album(_ id: String) async throws -> Album {
        guard let album = try await get("getAlbum", [("id", id)]).album else { throw SubsonicError(message: "Album not found.") }
        return album
    }

    func artists() async throws -> [Artist] {
        (try await get("getArtists").artists?.index ?? []).flatMap { $0.artist ?? [] }
    }

    func artist(_ id: String) async throws -> Artist {
        guard let artist = try await get("getArtist", [("id", id)]).artist else { throw SubsonicError(message: "Artist not found.") }
        return artist
    }

    func artistInfo(_ id: String) async throws -> ArtistInfo {
        try await get("getArtistInfo2", [("id", id), ("count", "12")]).artistInfo2 ?? ArtistInfo()
    }

    func topSongs(_ artistName: String, count: Int = 10) async throws -> [Song] {
        try await get("getTopSongs", [("artist", artistName), ("count", String(count))]).topSongs?.song ?? []
    }

    func similarSongs(artistID: String, count: Int = 50) async throws -> [Song] {
        try await get("getSimilarSongs2", [("id", artistID), ("count", String(count))]).similarSongs2?.song ?? []
    }

    func randomSongs(size: Int = 50, genre: String? = nil) async throws -> [Song] {
        try await get("getRandomSongs", [("size", String(size)), ("genre", genre)]).randomSongs?.song ?? []
    }

    func genres() async throws -> [Genre] {
        try await get("getGenres").genres?.genre ?? []
    }

    func starred() async throws -> SearchResult {
        try await get("getStarred2").starred2 ?? SearchResult()
    }

    func search(_ query: String, artists: Int = 12, albums: Int = 20, songs: Int = 30, songOffset: Int = 0) async throws -> SearchResult {
        let q = query.trimmingCharacters(in: .whitespaces)
        return try await get("search3", [
            // `""` is Navidrome's "match everything".
            ("query", q.isEmpty ? "\"\"" : q),
            ("artistCount", String(artists)), ("albumCount", String(albums)),
            ("songCount", String(songs)), ("songOffset", String(songOffset)),
        ]).searchResult3 ?? SearchResult()
    }

    func playlists() async throws -> [Playlist] {
        try await get("getPlaylists").playlists?.playlist ?? []
    }

    func playlist(_ id: String) async throws -> Playlist {
        guard let pl = try await get("getPlaylist", [("id", id)]).playlist else { throw SubsonicError(message: "Playlist not found.") }
        return pl
    }

    func createPlaylist(name: String, songIDs: [String]) async throws {
        var params: [(String, String?)] = [("name", name)]
        for id in songIDs { params.append(("songId", id)) }
        try await get("createPlaylist", params)
    }

    func updatePlaylist(id: String, name: String? = nil, add: [String] = [], removeIndexes: [Int] = []) async throws {
        var params: [(String, String?)] = [("playlistId", id), ("name", name)]
        for song in add { params.append(("songIdToAdd", song)) }
        for index in removeIndexes { params.append(("songIndexToRemove", String(index))) }
        try await get("updatePlaylist", params)
    }

    func deletePlaylist(_ id: String) async throws {
        try await get("deletePlaylist", [("id", id)])
    }

    enum StarKind { case song, album, artist }

    func setStarred(_ kind: StarKind, id: String, starred: Bool) async throws {
        let key = switch kind { case .song: "id"; case .album: "albumId"; case .artist: "artistId" }
        try await get(starred ? "star" : "unstar", [(key, id)])
    }

    func scrobble(_ id: String, submission: Bool, time: Date? = nil) async throws {
        try await get("scrobble", [
            ("id", id), ("submission", submission ? "true" : "false"),
            ("time", time.map { String(Int($0.timeIntervalSince1970 * 1000)) }),
        ])
    }

    func lyricsBySongID(_ id: String) async throws -> [StructuredLyrics] {
        try await get("getLyricsBySongId", [("id", id)]).lyricsList?.structuredLyrics ?? []
    }

    func lyrics(artist: String, title: String) async throws -> String? {
        try await get("getLyrics", [("artist", artist), ("title", title)]).lyrics?.value
    }
}
