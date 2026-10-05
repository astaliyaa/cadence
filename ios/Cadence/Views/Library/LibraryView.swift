import SwiftUI

struct LibraryView: View {
    @State private var recentlyAdded: [Album] = []

    private struct Row: Identifiable {
        let title: String
        let icon: String
        let route: Route
        var id: String { title }
    }

    private let rows: [Row] = [
        Row(title: "Playlists", icon: "music.note.list", route: .playlists),
        Row(title: "Artists", icon: "music.mic", route: .artists),
        Row(title: "Albums", icon: "square.stack", route: .allAlbums),
        Row(title: "Songs", icon: "music.note", route: .songs),
        Row(title: "Genres", icon: "guitars", route: .genres),
        Row(title: "Favorites", icon: "heart", route: .favorites),
        Row(title: "Downloaded", icon: "arrow.down.circle", route: .downloaded),
    ]

    private let columns = [GridItem(.flexible(), spacing: 16), GridItem(.flexible(), spacing: 16)]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                ForEach(rows) { row in
                    NavigationLink(value: row.route) {
                        HStack(spacing: 14) {
                            Image(systemName: row.icon)
                                .font(.title3)
                                .foregroundStyle(.tint)
                                .frame(width: 30)
                            Text(row.title).font(.title3)
                            Spacer()
                            Image(systemName: "chevron.right")
                                .font(.footnote.weight(.semibold))
                                .foregroundStyle(.tertiary)
                        }
                        .padding(.vertical, 12)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    Divider().padding(.leading, 44)
                }

                if !recentlyAdded.isEmpty {
                    NavigationLink(value: Route.albumList(.newest)) {
                        HStack(spacing: 4) {
                            Text("Recently Added").font(.title2.bold())
                            Image(systemName: "chevron.right").font(.title3.weight(.semibold)).foregroundStyle(.secondary)
                        }
                    }
                    .buttonStyle(.plain)
                    .padding(.top, 28)
                    .padding(.bottom, 12)

                    LazyVGrid(columns: columns, spacing: 20) {
                        ForEach(recentlyAdded) { AlbumGridCard(album: $0) }
                    }
                }
            }
            .padding(.horizontal)
            .padding(.bottom, 20)
        }
        .navigationTitle("Library")
        .task {
            if recentlyAdded.isEmpty {
                recentlyAdded = (try? await Session.shared.api?.albumList(.newest, size: 24)) ?? []
            }
        }
        .refreshable {
            recentlyAdded = (try? await Session.shared.api?.albumList(.newest, size: 24)) ?? []
        }
    }
}

/// Infinite grid of albums from getAlbumList2.
struct AlbumGridView: View {
    let title: String
    var sortable = false
    @State private var type: AlbumListType
    @State private var albums: [Album] = []
    @State private var exhausted = false
    @State private var loading = false
    @State private var genre: String?

    private let pageSize = 60
    private let columns = [GridItem(.flexible(), spacing: 16), GridItem(.flexible(), spacing: 16)]

    init(type: AlbumListType, title: String, sortable: Bool = false, genre: String? = nil) {
        _type = State(initialValue: type)
        _genre = State(initialValue: genre)
        self.title = title
        self.sortable = sortable
    }

    var body: some View {
        ScrollView {
            LazyVGrid(columns: columns, spacing: 22) {
                ForEach(albums) { album in
                    AlbumGridCard(album: album)
                        .onAppear {
                            if album.id == albums.last?.id { Task { await loadMore() } }
                        }
                }
            }
            .padding(.horizontal)
            if loading { ProgressView().padding() }
            if !loading && albums.isEmpty && exhausted {
                ContentUnavailableView("No Albums", systemImage: "square.stack")
            }
        }
        .navigationTitle(title)
        .toolbar {
            if sortable {
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        Picker("Sort By", selection: $type) {
                            ForEach([AlbumListType.alphabeticalByName, .alphabeticalByArtist, .newest, .byYear, .frequent, .recent]) { t in
                                Text(t.title).tag(t)
                            }
                        }
                    } label: {
                        Image(systemName: "arrow.up.arrow.down")
                    }
                }
            }
        }
        .task(id: type) {
            albums = []
            exhausted = false
            await loadMore()
        }
    }

    private func loadMore() async {
        guard !loading, !exhausted, let api = Session.shared.api else { return }
        loading = true
        defer { loading = false }
        let page = (try? await api.albumList(type, size: pageSize, offset: albums.count, genre: genre)) ?? []
        albums += page.filter { a in !albums.contains { $0.id == a.id } }
        if page.count < pageSize { exhausted = true }
    }
}

struct ArtistsListView: View {
    @State private var artists: [Artist] = []
    @State private var query = ""
    @State private var loaded = false

    var body: some View {
        List(filtered) { artist in
            NavigationLink(value: Route.artist(artist.id)) {
                HStack(spacing: 12) {
                    ArtworkView(id: artist.imageID, size: 44, circle: true, placeholderSymbol: "music.mic")
                    Text(artist.name)
                }
            }
        }
        .listStyle(.plain)
        .overlay { if !loaded { LoadingView() } }
        .navigationTitle("Artists")
        .searchable(text: $query, prompt: "Find in Artists")
        .task {
            guard !loaded, let api = Session.shared.api else { return }
            artists = (try? await DataCache.shared.load("artists") { try await api.artists() }) ?? []
            loaded = true
        }
    }

    private var filtered: [Artist] {
        let q = query.trimmingCharacters(in: .whitespaces).lowercased()
        return q.isEmpty ? artists : artists.filter { $0.name.lowercased().contains(q) }
    }
}

struct SongsListView: View {
    @Environment(PlayerModel.self) private var player
    @State private var songs: [Song] = []
    @State private var exhausted = false
    @State private var loading = false
    private let pageSize = 200

    var body: some View {
        List {
            PlayShuffleButtons(
                play: { player.play(songs, source: "Songs") },
                shuffle: { Task { await shuffleAll() } }
            )
            .listRowSeparator(.hidden)
            .buttonStyle(.borderless)

            ForEach(Array(songs.enumerated()), id: \.element.id) { i, song in
                SongRow(song: song) { player.play(songs, startAt: i, source: "Songs") }
                    .songSwipeActions(song)
                    .onAppear { if i == songs.count - 1 { Task { await loadMore() } } }
            }
            if loading { ProgressView().frame(maxWidth: .infinity) }
        }
        .listStyle(.plain)
        .navigationTitle("Songs")
        .task { if songs.isEmpty { await loadMore() } }
    }

    private func loadMore() async {
        guard !loading, !exhausted, let api = Session.shared.api else { return }
        loading = true
        defer { loading = false }
        let page = (try? await api.search("", artists: 0, albums: 0, songs: pageSize, songOffset: songs.count).song) ?? []
        songs += page
        if page.count < pageSize { exhausted = true }
    }

    private func shuffleAll() async {
        guard let api = Session.shared.api else { return }
        let random = (try? await api.randomSongs(size: 300)) ?? songs
        player.play(random, shuffle: true, source: "Songs")
    }
}

struct PlaylistsListView: View {
    @State private var playlists: [Playlist] = []
    @State private var askingName = false
    @State private var newName = ""

    var body: some View {
        List {
            Button {
                askingName = true
            } label: {
                Label("New Playlist…", systemImage: "plus")
            }
            ForEach(playlists) { pl in
                NavigationLink(value: Route.playlist(pl.id)) {
                    HStack(spacing: 12) {
                        ArtworkView(id: pl.coverArt, size: 56, cornerRadius: 6, placeholderSymbol: "music.note.list")
                        VStack(alignment: .leading, spacing: 2) {
                            Text(pl.name)
                            Text(Format.count(pl.songCount ?? 0, "song")).font(.subheadline).foregroundStyle(.secondary)
                        }
                    }
                }
                .contextMenu {
                    Button { Actions.playPlaylist(pl.id) } label: { Label("Play", systemImage: "play") }
                    Button { Actions.playPlaylist(pl.id, shuffle: true) } label: { Label("Shuffle", systemImage: "shuffle") }
                }
            }
        }
        .listStyle(.plain)
        .navigationTitle("Playlists")
        .task { await load() }
        .refreshable { await load() }
        .onReceive(NotificationCenter.default.publisher(for: .playlistChanged)) { _ in Task { await load() } }
        .alert("New Playlist", isPresented: $askingName) {
            TextField("Playlist name", text: $newName)
            Button("Cancel", role: .cancel) { newName = "" }
            Button("Create") {
                Actions.createPlaylist(named: newName, with: [])
                newName = ""
                Task {
                    try? await Task.sleep(for: .milliseconds(600))
                    await load()
                }
            }
        }
    }

    private func load() async {
        playlists = (try? await Session.shared.api?.playlists()) ?? []
    }
}

struct GenresView: View {
    @State private var genres: [Genre] = []
    private let columns = [GridItem(.flexible(), spacing: 14), GridItem(.flexible(), spacing: 14)]

    var body: some View {
        ScrollView {
            LazyVGrid(columns: columns, spacing: 14) {
                ForEach(genres) { GenreTile(genre: $0) }
            }
            .padding()
        }
        .navigationTitle("Genres")
        .task {
            let all = (try? await Session.shared.api?.genres()) ?? []
            genres = all.filter { ($0.albumCount ?? 0) > 0 }.sorted { ($0.albumCount ?? 0) > ($1.albumCount ?? 0) }
        }
    }
}

struct GenreTile: View {
    let genre: Genre

    var body: some View {
        NavigationLink(value: Route.genre(genre.value)) {
            let hue = genre.value.stableHue
            ZStack(alignment: .bottomLeading) {
                LinearGradient(
                    colors: [Color(hue: hue, saturation: 0.7, brightness: 0.8), Color(hue: (hue + 0.11).truncatingRemainder(dividingBy: 1), saturation: 0.75, brightness: 0.5)],
                    startPoint: .topLeading, endPoint: .bottomTrailing
                )
                Text(genre.value)
                    .font(.headline)
                    .foregroundStyle(.white)
                    .padding(12)
            }
            .aspectRatio(1.6, contentMode: .fit)
            .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
        }
        .buttonStyle(.plain)
    }
}

struct GenreView: View {
    let genre: String
    @Environment(PlayerModel.self) private var player

    var body: some View {
        AlbumGridView(type: .byGenre, title: genre, genre: genre)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        Task {
                            let songs = (try? await Session.shared.api?.randomSongs(size: 200, genre: genre)) ?? []
                            player.play(songs, source: genre)
                        }
                    } label: {
                        Image(systemName: "play.circle.fill").font(.title2)
                    }
                }
            }
    }
}

struct FavoritesView: View {
    enum Kind: String, CaseIterable { case songs = "Songs", albums = "Albums", artists = "Artists" }

    @Environment(PlayerModel.self) private var player
    @State private var kind: Kind = .songs
    @State private var starred = SearchResult()
    @State private var loaded = false
    private let columns = [GridItem(.flexible(), spacing: 16), GridItem(.flexible(), spacing: 16)]

    var body: some View {
        List {
            Picker("Show", selection: $kind) {
                ForEach(Kind.allCases, id: \.self) { Text($0.rawValue).tag($0) }
            }
            .pickerStyle(.segmented)
            .listRowSeparator(.hidden)

            switch kind {
            case .songs:
                let songs = starred.song ?? []
                if !songs.isEmpty {
                    PlayShuffleButtons(
                        play: { player.play(songs, source: "Favorite Songs") },
                        shuffle: { player.play(songs, shuffle: true, source: "Favorite Songs") }
                    )
                    .buttonStyle(.borderless)
                    .listRowSeparator(.hidden)
                }
                ForEach(Array(songs.enumerated()), id: \.element.id) { i, song in
                    SongRow(song: song) { player.play(songs, startAt: i, source: "Favorite Songs") }
                        .songSwipeActions(song)
                }
            case .albums:
                LazyVGrid(columns: columns, spacing: 20) {
                    ForEach(starred.album ?? []) { AlbumGridCard(album: $0) }
                }
                .listRowSeparator(.hidden)
            case .artists:
                ForEach(starred.artist ?? []) { artist in
                    NavigationLink(value: Route.artist(artist.id)) {
                        HStack(spacing: 12) {
                            ArtworkView(id: artist.imageID, size: 44, circle: true, placeholderSymbol: "music.mic")
                            Text(artist.name)
                        }
                    }
                }
            }
        }
        .listStyle(.plain)
        .overlay { if !loaded { LoadingView() } }
        .navigationTitle("Favorites")
        .task { await load() }
        .refreshable { await load() }
    }

    private func load() async {
        starred = (try? await Session.shared.api?.starred()) ?? SearchResult()
        loaded = true
    }
}

extension View {
    /// Apple Music's swipe actions on songs: Play Next (leading), Play Last (trailing).
    func songSwipeActions(_ song: Song) -> some View {
        swipeActions(edge: .leading, allowsFullSwipe: true) {
            Button { Actions.playNext([song]) } label: {
                Label("Play Next", systemImage: "text.line.first.and.arrowtriangle.forward")
            }
            .tint(.accentColor)
        }
        .swipeActions(edge: .trailing, allowsFullSwipe: true) {
            Button { Actions.playLater([song]) } label: {
                Label("Play Last", systemImage: "text.line.last.and.arrowtriangle.forward")
            }
            .tint(.orange)
        }
        .contextMenu { SongMenuItems(songs: [song]) }
    }
}
