import Foundation

// Subsonic / OpenSubsonic shapes as returned by Navidrome (only the fields we use).

struct ArtistRef: Codable, Hashable {
    let id: String?
    let name: String
}

struct ReplayGain: Codable, Hashable {
    var trackGain: Double?
    var albumGain: Double?
    var trackPeak: Double?
    var albumPeak: Double?
}

struct ItemDate: Codable, Hashable {
    var year: Int?
    var month: Int?
    var day: Int?
}

struct NameRef: Codable, Hashable {
    let name: String
}

struct Song: Codable, Identifiable, Hashable {
    let id: String
    var title: String
    var album: String?
    var albumId: String?
    var artist: String?
    var artistId: String?
    var displayArtist: String?
    var displayAlbumArtist: String?
    var track: Int?
    var discNumber: Int?
    var year: Int?
    var genre: String?
    var coverArt: String?
    var duration: Int?
    var bitRate: Int?
    var bitDepth: Int?
    var samplingRate: Int?
    var suffix: String?
    var contentType: String?
    var size: Int64?
    var starred: String?
    var playCount: Int?
    var replayGain: ReplayGain?
    var explicitStatus: String?

    var artistName: String { displayArtist ?? artist ?? "Unknown Artist" }
    var albumArtistName: String { displayAlbumArtist ?? artistName }
    var isExplicit: Bool { explicitStatus == "explicit" || explicitStatus == "e" }
    var isLoved: Bool { starred != nil }
}

struct Album: Codable, Identifiable, Hashable {
    let id: String
    var name: String
    var artist: String?
    var artistId: String?
    var displayArtist: String?
    var coverArt: String?
    var songCount: Int?
    var duration: Int?
    var playCount: Int?
    var created: String?
    var year: Int?
    var genre: String?
    var genres: [NameRef]?
    var starred: String?
    var recordLabels: [NameRef]?
    var releaseTypes: [String]?
    var releaseDate: ItemDate?
    var originalReleaseDate: ItemDate?
    var isCompilation: Bool?
    var explicitStatus: String?
    var song: [Song]?

    var artistName: String { displayArtist ?? artist ?? "Unknown Artist" }
    var isExplicit: Bool { explicitStatus == "explicit" || explicitStatus == "e" }
    var isSingleOrEP: Bool { releaseTypes?.contains { $0.lowercased() == "single" || $0.lowercased() == "ep" } ?? false }
    var isCompilationRelease: Bool {
        (isCompilation ?? false) || (releaseTypes?.contains { $0.lowercased() == "compilation" } ?? false)
    }
}

struct Artist: Codable, Identifiable, Hashable {
    let id: String
    var name: String
    var coverArt: String?
    var artistImageUrl: String?
    var albumCount: Int?
    var starred: String?
    var album: [Album]?

    /// Navidrome serves artist images through getCoverArt with an "ar-" id.
    var imageID: String { coverArt ?? "ar-\(id)" }
}

struct ArtistInfo: Codable, Hashable {
    var biography: String?
    var largeImageUrl: String?
    var similarArtist: [Artist]?
}

struct Playlist: Codable, Identifiable, Hashable {
    let id: String
    var name: String
    var comment: String?
    var owner: String?
    var songCount: Int?
    var duration: Int?
    var coverArt: String?
    var readonly: Bool?
    var entry: [Song]?
}

struct Genre: Codable, Hashable, Identifiable {
    let value: String
    var songCount: Int?
    var albumCount: Int?
    var id: String { value }
}

struct LyricLine: Codable, Hashable {
    var start: Int?
    var value: String
}

struct StructuredLyrics: Codable, Hashable {
    var synced: Bool
    var line: [LyricLine]?
    var offset: Int?
}

// MARK: - Response envelope

struct SubsonicErrorBody: Codable {
    let code: Int?
    let message: String?
}

struct AlbumListBody: Codable { var album: [Album]? }
struct ArtistIndex: Codable { var name: String?; var artist: [Artist]? }
struct ArtistsBody: Codable { var index: [ArtistIndex]? }
struct SongListBody: Codable { var song: [Song]? }
struct GenresBody: Codable { var genre: [Genre]? }
struct PlaylistsBody: Codable { var playlist: [Playlist]? }
struct LyricsListBody: Codable { var structuredLyrics: [StructuredLyrics]? }
struct PlainLyricsBody: Codable { var value: String? }
struct ExtensionBody: Codable { var name: String }

struct SearchResult: Codable {
    var artist: [Artist]?
    var album: [Album]?
    var song: [Song]?
}

struct SubsonicResponse: Codable {
    var status: String
    var error: SubsonicErrorBody?
    var type: String?
    var serverVersion: String?
    var albumList2: AlbumListBody?
    var album: Album?
    var artists: ArtistsBody?
    var artist: Artist?
    var artistInfo2: ArtistInfo?
    var topSongs: SongListBody?
    var similarSongs2: SongListBody?
    var randomSongs: SongListBody?
    var starred2: SearchResult?
    var genres: GenresBody?
    var searchResult3: SearchResult?
    var playlists: PlaylistsBody?
    var playlist: Playlist?
    var lyricsList: LyricsListBody?
    var lyrics: PlainLyricsBody?
    var openSubsonicExtensions: [ExtensionBody]?
}

struct SubsonicRoot: Codable {
    var response: SubsonicResponse

    enum CodingKeys: String, CodingKey {
        case response = "subsonic-response"
    }
}

enum AlbumListType: String, CaseIterable, Identifiable {
    case newest, recent, frequent, random, alphabeticalByName, alphabeticalByArtist, starred, byYear, byGenre, highest
    var id: String { rawValue }

    var title: String {
        switch self {
        case .newest: "Recently Added"
        case .recent: "Recently Played"
        case .frequent: "Most Played"
        case .random: "Discover"
        case .alphabeticalByName: "Title"
        case .alphabeticalByArtist: "Artist"
        case .starred: "Favorite Albums"
        case .byYear: "Release Date"
        case .byGenre: "Genre"
        case .highest: "Top Rated"
        }
    }
}
