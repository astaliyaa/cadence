import SwiftUI

/// A song in a list: artwork (or track number), title, artist and a "…" menu.
struct SongRow: View {
    let song: Song
    var trackNumber: Int?
    var showArtist = true
    var showArtwork = true
    var playlistContext: (playlist: Playlist, index: Int)?
    var onTap: (() -> Void)?

    @Environment(PlayerModel.self) private var player
    @Environment(Favorites.self) private var favorites

    var body: some View {
        HStack(spacing: 4) {
            // The tappable part; the "…" menu stays separately tappable.
            content
                .contentShape(Rectangle())
                .onTapGesture { onTap?() }
            Menu {
                SongMenuItems(songs: [song], playlistContext: playlistContext)
            } label: {
                Image(systemName: "ellipsis")
                    .font(.body.weight(.semibold))
                    .foregroundStyle(.secondary)
                    .frame(width: 32, height: 36)
                    .contentShape(Rectangle())
            }
        }
        .padding(.vertical, 2)
    }

    private var content: some View {
        let isCurrent = player.current?.id == song.id
        return HStack(spacing: 12) {
            if let trackNumber {
                ZStack {
                    if isCurrent {
                        NowPlayingIndicator(playing: player.isPlaying)
                    } else {
                        Text("\(trackNumber)")
                            .font(.body.monospacedDigit())
                            .foregroundStyle(.secondary)
                    }
                }
                .frame(width: 26)
            } else if showArtwork {
                ZStack {
                    ArtworkView(id: song.coverArt, size: 46, cornerRadius: 5)
                    if isCurrent {
                        RoundedRectangle(cornerRadius: 5).fill(.black.opacity(0.35)).frame(width: 46, height: 46)
                        NowPlayingIndicator(playing: player.isPlaying).foregroundStyle(.white).tint(.white)
                    }
                }
            }

            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 4) {
                    Text(song.title)
                        .lineLimit(1)
                        .foregroundStyle(isCurrent && trackNumber != nil ? Color.accentColor : Color.primary)
                    if song.isExplicit { ExplicitBadge() }
                }
                if showArtist {
                    Text(song.artistName)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            }

            Spacer(minLength: 4)

            if favorites.isLoved(song.id, server: song.starred) {
                Image(systemName: "heart.fill")
                    .font(.caption)
                    .foregroundStyle(.tint)
            }
        }
    }
}

/// Long-press / "…" menu items for one or more songs.
struct SongMenuItems: View {
    let songs: [Song]
    var playlistContext: (playlist: Playlist, index: Int)?
    var hideAlbum = false

    var body: some View {
        let single = songs.count == 1 ? songs.first : nil
        Button { Actions.playNext(songs) } label: {
            Label("Play Next", systemImage: "text.line.first.and.arrowtriangle.forward")
        }
        Button { Actions.playLater(songs) } label: {
            Label("Play Last", systemImage: "text.line.last.and.arrowtriangle.forward")
        }
        if let song = single {
            Button { Actions.startStation(from: song) } label: {
                Label("Create Station", systemImage: "dot.radiowaves.left.and.right")
            }
        }
        Divider()
        if let song = single {
            let loved = Favorites.shared.isLoved(song.id, server: song.starred)
            Button { Favorites.shared.toggle(.song, id: song.id, current: loved) } label: {
                Label(loved ? "Undo Favorite" : "Favorite", systemImage: loved ? "heart.slash" : "heart")
            }
        }
        Button { Router.shared.addToPlaylist = SongBatch(songs: songs) } label: {
            Label("Add to Playlist…", systemImage: "text.badge.plus")
        }
        if let song = single {
            Divider()
            if let albumID = song.albumId, !hideAlbum {
                Button { Router.shared.go(.album(albumID)) } label: { Label("Go to Album", systemImage: "square.stack") }
            }
            if let artistID = song.artistId {
                Button { Router.shared.go(.artist(artistID)) } label: { Label("Go to Artist", systemImage: "music.mic") }
            }
        }
        if let context = playlistContext {
            Divider()
            Button(role: .destructive) {
                Task {
                    try? await Session.shared.api?.updatePlaylist(id: context.playlist.id, removeIndexes: [context.index])
                    DataCache.shared.invalidate(prefix: "playlist")
                    NotificationCenter.default.post(name: .playlistChanged, object: context.playlist.id)
                }
            } label: {
                Label("Remove from Playlist", systemImage: "trash")
            }
        }
    }
}

struct AlbumMenuItems: View {
    let album: Album

    var body: some View {
        Button { Actions.playAlbum(album.id) } label: { Label("Play", systemImage: "play") }
        Button { Actions.playAlbum(album.id, shuffle: true) } label: { Label("Shuffle", systemImage: "shuffle") }
        Divider()
        Button { Actions.queueAlbum(album.id, next: true) } label: {
            Label("Play Next", systemImage: "text.line.first.and.arrowtriangle.forward")
        }
        Button { Actions.queueAlbum(album.id, next: false) } label: {
            Label("Play Last", systemImage: "text.line.last.and.arrowtriangle.forward")
        }
        Divider()
        let loved = Favorites.shared.isLoved(album.id, server: album.starred)
        Button { Favorites.shared.toggle(.album, id: album.id, current: loved) } label: {
            Label(loved ? "Undo Favorite" : "Favorite", systemImage: loved ? "heart.slash" : "heart")
        }
        Button {
            Task {
                if let songs = await Actions.album(album.id)?.song {
                    Router.shared.addToPlaylist = SongBatch(songs: songs)
                }
            }
        } label: {
            Label("Add to Playlist…", systemImage: "text.badge.plus")
        }
        if let artistID = album.artistId {
            Divider()
            Button { Router.shared.go(.artist(artistID)) } label: { Label("Go to Artist", systemImage: "music.mic") }
        }
    }
}

extension Notification.Name {
    static let playlistChanged = Notification.Name("cadence.playlistChanged")
}

/// Sheet for adding songs to an existing or new playlist.
struct AddToPlaylistSheet: View {
    let batch: SongBatch
    @Environment(\.dismiss) private var dismiss
    @State private var playlists: [Playlist] = []
    @State private var newName = ""
    @State private var askingName = false

    var body: some View {
        NavigationStack {
            List {
                Button {
                    askingName = true
                } label: {
                    Label("New Playlist…", systemImage: "plus")
                }
                ForEach(playlists.filter { $0.readonly != true && ($0.owner == nil || $0.owner == Session.shared.api?.creds.username) }) { pl in
                    Button {
                        Actions.add(batch.songs.map(\.id), to: pl)
                        dismiss()
                    } label: {
                        HStack(spacing: 12) {
                            ArtworkView(id: pl.coverArt, size: 44, cornerRadius: 5, placeholderSymbol: "music.note.list")
                            VStack(alignment: .leading) {
                                Text(pl.name).foregroundStyle(.primary)
                                Text(Format.count(pl.songCount ?? 0, "song")).font(.caption).foregroundStyle(.secondary)
                            }
                        }
                    }
                }
            }
            .navigationTitle("Add to Playlist")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
            }
            .task { playlists = (try? await Session.shared.api?.playlists()) ?? [] }
            .alert("New Playlist", isPresented: $askingName) {
                TextField("Playlist name", text: $newName)
                Button("Cancel", role: .cancel) {}
                Button("Create") {
                    Actions.createPlaylist(named: newName, with: batch.songs.map(\.id))
                    dismiss()
                }
            }
        }
        .presentationDetents([.medium, .large])
    }
}
