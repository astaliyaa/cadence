import Foundation
import Observation

/// Favorites with optimistic local overrides on top of what the server last said.
@Observable
@MainActor
final class Favorites {
    static let shared = Favorites()
    private var overrides: [String: Bool] = [:]

    func isLoved(_ id: String, server: String?) -> Bool {
        overrides[id] ?? (server != nil)
    }

    func toggle(_ kind: SubsonicClient.StarKind, id: String, current: Bool) {
        let next = !current
        overrides[id] = next
        Task {
            do {
                try await Session.shared.api?.setStarred(kind, id: id, starred: next)
                DataCache.shared.invalidate(prefix: "starred")
            } catch {
                overrides[id] = current
                Toast.shared.show("Couldn't update Favorites")
            }
        }
    }
}

/// Lightweight toast ("Added to Up Next") shown above the tab bar.
@Observable
@MainActor
final class Toast {
    static let shared = Toast()
    private(set) var message: String?
    @ObservationIgnored private var hideTask: Task<Void, Never>?

    func show(_ text: String) {
        message = text
        hideTask?.cancel()
        hideTask = Task {
            try? await Task.sleep(for: .seconds(2.2))
            if !Task.isCancelled { message = nil }
        }
    }
}

/// Common "play this" operations used across screens.
@MainActor
enum Actions {
    static var player: PlayerModel { PlayerModel.shared }

    static func album(_ id: String) async -> Album? {
        guard let api = Session.shared.api else { return nil }
        return try? await DataCache.shared.load("album:\(id)") { try await api.album(id) }
    }

    static func playAlbum(_ id: String, shuffle: Bool = false) {
        Task {
            guard let album = await album(id), let songs = album.song else { return }
            player.play(songs, shuffle: shuffle ? true : nil, source: album.name)
        }
    }

    static func queueAlbum(_ id: String, next: Bool) {
        Task {
            guard let songs = await album(id)?.song else { return }
            if next { player.playNext(songs) } else { player.addToQueue(songs) }
            Toast.shared.show(next ? "Album will play next" : "Added album to Up Next")
        }
    }

    static func playPlaylist(_ id: String, shuffle: Bool = false) {
        Task {
            guard let api = Session.shared.api, let pl = try? await api.playlist(id), let songs = pl.entry else { return }
            player.play(songs, shuffle: shuffle ? true : nil, source: pl.name)
        }
    }

    static func shuffleArtist(_ artist: Artist) {
        Task {
            guard let api = Session.shared.api, let full = try? await api.artist(artist.id) else { return }
            var songs: [Song] = []
            for album in full.album ?? [] {
                if let tracks = await self.album(album.id)?.song { songs += tracks }
            }
            player.play(songs, shuffle: true, source: artist.name)
        }
    }

    static func startStation(from song: Song) {
        Task {
            guard let api = Session.shared.api else { return }
            var songs: [Song] = []
            if let artistID = song.artistId { songs = (try? await api.similarSongs(artistID: artistID, count: 60)) ?? [] }
            if songs.count < 5 { songs += (try? await api.randomSongs(size: 50, genre: song.genre)) ?? [] }
            player.play([song] + songs.filter { $0.id != song.id }, source: "\(song.title) Station")
        }
    }

    static func playNext(_ songs: [Song]) {
        player.playNext(songs)
        Toast.shared.show("Will play next")
    }

    static func playLater(_ songs: [Song]) {
        player.addToQueue(songs)
        Toast.shared.show("Added to Up Next")
    }

    static func add(_ songIDs: [String], to playlist: Playlist) {
        Task {
            do {
                try await Session.shared.api?.updatePlaylist(id: playlist.id, add: songIDs)
                DataCache.shared.invalidate(prefix: "playlist")
                Toast.shared.show("Added to “\(playlist.name)”")
            } catch {
                Toast.shared.show("Couldn't add to playlist")
            }
        }
    }

    static func createPlaylist(named name: String, with songIDs: [String]) {
        let trimmed = name.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty else { return }
        Task {
            do {
                try await Session.shared.api?.createPlaylist(name: trimmed, songIDs: songIDs)
                DataCache.shared.invalidate(prefix: "playlist")
                Toast.shared.show(songIDs.isEmpty ? "Created “\(trimmed)”" : "Added to “\(trimmed)”")
            } catch {
                Toast.shared.show("Couldn't create playlist")
            }
        }
    }
}
