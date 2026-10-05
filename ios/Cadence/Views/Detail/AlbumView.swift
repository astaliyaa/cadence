import SwiftUI

struct AlbumView: View {
    let id: String

    @Environment(PlayerModel.self) private var player
    @Environment(Favorites.self) private var favorites
    @State private var album: Album?
    @State private var moreByArtist: [Album] = []
    @State private var error: String?

    var body: some View {
        Group {
            if let album {
                content(album)
            } else if let error {
                ContentUnavailableView("Couldn't Load Album", systemImage: "exclamationmark.triangle", description: Text(error))
            } else {
                LoadingView()
            }
        }
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
    }

    private func content(_ album: Album) -> some View {
        let songs = album.song ?? []
        let discs = Set(songs.map { $0.discNumber ?? 1 }).sorted()
        return ScrollView {
            VStack(spacing: 0) {
                header(album, songs: songs)
                    .padding(.bottom, 18)

                ForEach(discs, id: \.self) { disc in
                    if discs.count > 1 {
                        Text("Disc \(disc)")
                            .font(.headline)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.top, 18)
                            .padding(.bottom, 6)
                            .padding(.horizontal)
                    }
                    let discSongs = songs.filter { ($0.discNumber ?? 1) == disc }
                    ForEach(discSongs) { song in
                        let index = songs.firstIndex(of: song) ?? 0
                        VStack(spacing: 0) {
                            SongRow(
                                song: song,
                                trackNumber: song.track ?? index + 1,
                                showArtist: song.artistName != album.artistName,
                                onTap: { player.play(songs, startAt: index, source: album.name) }
                            )
                            .padding(.horizontal)
                            .contextMenu { SongMenuItems(songs: [song], hideAlbum: true) }
                            Divider().padding(.leading, 54)
                        }
                    }
                }

                footer(album, songs: songs)

                if !moreByArtist.isEmpty {
                    Shelf(title: "More by \(album.artistName)", route: album.artistId.map { Route.artist($0) }) {
                        ForEach(moreByArtist) { AlbumCard(album: $0, subtitle: .year) }
                    }
                    .padding(.top, 24)
                }
            }
            .padding(.bottom, 24)
        }
        .toolbar {
            ToolbarItemGroup(placement: .topBarTrailing) {
                let loved = favorites.isLoved(album.id, server: album.starred)
                Button { favorites.toggle(.album, id: album.id, current: loved) } label: {
                    Image(systemName: loved ? "heart.fill" : "heart")
                }
                Menu { AlbumMenuItems(album: album) } label: { Image(systemName: "ellipsis.circle") }
            }
        }
    }

    private func header(_ album: Album, songs: [Song]) -> some View {
        VStack(spacing: 6) {
            MotionArtworkView(albumID: album.id, album: album.name, artist: album.artistName, coverID: album.coverArt, size: 270)
                .shadow(color: .black.opacity(0.25), radius: 18, y: 10)
                .padding(.top, 12)
                .padding(.bottom, 14)

            HStack(spacing: 6) {
                Text(album.name)
                    .font(.title2.bold())
                    .multilineTextAlignment(.center)
                if album.isExplicit { ExplicitBadge() }
            }
            .padding(.horizontal)

            Button {
                if let artistID = album.artistId { Router.shared.go(.artist(artistID)) }
            } label: {
                Text(album.artistName).font(.title3)
            }
            .buttonStyle(.plain)
            .foregroundStyle(.tint)

            Text(meta(album, songs: songs))
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)

            PlayShuffleButtons(
                play: { player.play(songs, source: album.name) },
                shuffle: { player.play(songs, shuffle: true, source: album.name) }
            )
            .padding(.horizontal)
            .padding(.top, 14)
        }
        .frame(maxWidth: .infinity)
    }

    private func meta(_ album: Album, songs: [Song]) -> String {
        var parts: [String] = []
        if let genre = album.genres?.first?.name ?? album.genre { parts.append(genre.uppercased()) }
        if let year = album.year { parts.append(String(year)) }
        if let quality = Quality.of(album: songs) { parts.append(quality.rawValue) }
        return parts.joined(separator: " · ")
    }

    private func footer(_ album: Album, songs: [Song]) -> some View {
        let total = album.duration ?? songs.reduce(0) { $0 + ($1.duration ?? 0) }
        return VStack(alignment: .leading, spacing: 3) {
            if let date = Format.releaseDate(album) { Text(date) }
            Text("\(Format.count(songs.count, "song")), \(Format.longDuration(total))")
            if let labels = album.recordLabels, !labels.isEmpty {
                Text("℗ " + labels.map(\.name).joined(separator: ", "))
            }
        }
        .font(.footnote)
        .foregroundStyle(.secondary)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal)
        .padding(.top, 16)
    }

    private func load() async {
        guard album == nil, let api = Session.shared.api else { return }
        do {
            let loaded = try await DataCache.shared.load("album:\(id)") { try await api.album(id) }
            album = loaded
            if let artistID = loaded.artistId {
                let artist = try? await DataCache.shared.load("artist:\(artistID)") { try await api.artist(artistID) }
                moreByArtist = (artist?.album ?? []).filter { $0.id != id }
            }
        } catch {
            self.error = error.localizedDescription
        }
    }
}
