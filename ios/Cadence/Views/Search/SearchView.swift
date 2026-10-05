import SwiftUI

struct SearchView: View {
    @Environment(PlayerModel.self) private var player
    @State private var query = ""
    @State private var results = SearchResult()
    @State private var searching = false
    @State private var genres: [Genre] = []

    private let columns = [GridItem(.flexible(), spacing: 14), GridItem(.flexible(), spacing: 14)]

    var body: some View {
        ScrollView {
            if query.trimmingCharacters(in: .whitespaces).isEmpty {
                browse
            } else {
                resultsView
            }
        }
        .navigationTitle("Search")
        .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: "Artists, Albums, Songs")
        .autocorrectionDisabled()
        .textInputAutocapitalization(.never)
        .task(id: query) { await search() }
        .task {
            if genres.isEmpty {
                let all = (try? await Session.shared.api?.genres()) ?? []
                genres = Array(all.filter { ($0.albumCount ?? 0) > 0 }.sorted { ($0.albumCount ?? 0) > ($1.albumCount ?? 0) }.prefix(24))
            }
        }
    }

    private var browse: some View {
        VStack(alignment: .leading, spacing: 12) {
            if !genres.isEmpty {
                Text("Browse Categories").font(.title2.bold())
                LazyVGrid(columns: columns, spacing: 14) {
                    ForEach(genres) { GenreTile(genre: $0) }
                }
            }
        }
        .padding()
    }

    private var resultsView: some View {
        let artists = results.artist ?? []
        let albums = results.album ?? []
        let songs = results.song ?? []
        return VStack(alignment: .leading, spacing: 26) {
            if searching && artists.isEmpty && albums.isEmpty && songs.isEmpty {
                LoadingView()
            } else if artists.isEmpty && albums.isEmpty && songs.isEmpty {
                ContentUnavailableView.search(text: query)
            }
            if !artists.isEmpty {
                Shelf(title: "Artists") { ForEach(artists) { ArtistCircle(artist: $0, size: 110) } }
            }
            if !albums.isEmpty {
                Shelf(title: "Albums") { ForEach(albums) { AlbumCard(album: $0, width: 150) } }
            }
            if !songs.isEmpty {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Songs").font(.title2.bold())
                    ForEach(Array(songs.enumerated()), id: \.element.id) { i, song in
                        SongRow(song: song, onTap: { player.play(songs, startAt: i, source: "“\(query)”") })
                            .contextMenu { SongMenuItems(songs: [song]) }
                        Divider().padding(.leading, 58)
                    }
                }
                .padding(.horizontal)
            }
        }
        .padding(.vertical)
    }

    private func search() async {
        let q = query.trimmingCharacters(in: .whitespaces)
        guard !q.isEmpty, let api = Session.shared.api else {
            results = SearchResult()
            return
        }
        // Debounce typing.
        try? await Task.sleep(for: .milliseconds(280))
        guard !Task.isCancelled else { return }
        searching = true
        defer { searching = false }
        if let found = try? await api.search(q, artists: 12, albums: 20, songs: 40), !Task.isCancelled {
            results = found
        }
    }
}
