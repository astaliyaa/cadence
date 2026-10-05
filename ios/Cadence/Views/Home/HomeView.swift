import SwiftUI

struct HomeView: View {
    @State private var recent: [Album] = []
    @State private var newest: [Album] = []
    @State private var frequent: [Album] = []
    @State private var random: [Album] = []
    @State private var favorites: [Album] = []
    @State private var playlists: [Playlist] = []
    @State private var loaded = false
    @State private var error: String?
    @State private var showSettings = false

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 30) {
                if !loaded {
                    LoadingView()
                } else if let error, newest.isEmpty {
                    ContentUnavailableView("Can't Load Your Library", systemImage: "wifi.exclamationmark", description: Text(error))
                }

                let picks = topPicks
                if !picks.isEmpty {
                    Shelf(title: "Top Picks for You") {
                        ForEach(picks) { pick in
                            TopPickCard(label: pick.label, album: pick.album)
                        }
                    }
                }
                albumShelf("Recently Played", recent, route: .albumList(.recent))
                albumShelf("Recently Added", newest, route: .albumList(.newest))
                albumShelf("Most Played", frequent, route: .albumList(.frequent))
                if !playlists.isEmpty {
                    Shelf(title: "Your Playlists", route: .playlists) {
                        ForEach(playlists) { PlaylistCard(playlist: $0) }
                    }
                }
                albumShelf("Favorite Albums", favorites, route: .favorites)
                albumShelf("Discover Something", random, route: .albumList(.random))
            }
            .padding(.vertical, 8)
        }
        .navigationTitle(greeting)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button { showSettings = true } label: {
                    Image(systemName: "person.crop.circle").font(.title3)
                }
                .accessibilityLabel("Settings")
            }
        }
        .sheet(isPresented: $showSettings) {
            NavigationStack { SettingsView() }
        }
        .task { if !loaded { await load() } }
        .refreshable { await load() }
    }

    @ViewBuilder
    private func albumShelf(_ title: String, _ albums: [Album], route: Route) -> some View {
        if !albums.isEmpty {
            Shelf(title: title, route: route) {
                ForEach(albums) { AlbumCard(album: $0) }
            }
        }
    }

    private var greeting: String {
        let hour = Calendar.current.component(.hour, from: Date())
        switch hour {
        case 5..<12: return "Good Morning"
        case 12..<18: return "Good Afternoon"
        default: return "Good Evening"
        }
    }

    private struct TopPick: Identifiable {
        let label: String
        let album: Album
        var id: String { album.id }
    }

    private var topPicks: [TopPick] {
        var seen = Set<String>()
        var out: [TopPick] = []
        func pick(_ label: String, _ list: [Album]) {
            if let a = list.first(where: { !seen.contains($0.id) }) {
                seen.insert(a.id)
                out.append(TopPick(label: label, album: a))
            }
        }
        pick("Recently Added", newest)
        pick("Most Played", frequent)
        pick("Rediscover", random)
        pick("From Your Favorites", favorites)
        pick("Jump Back In", recent)
        return out
    }

    private func load() async {
        guard let api = Session.shared.api else { return }
        async let r = api.albumList(.recent, size: 20)
        async let n = api.albumList(.newest, size: 20)
        async let f = api.albumList(.frequent, size: 20)
        async let x = api.albumList(.random, size: 20)
        async let s = api.starred()
        async let p = api.playlists()
        do {
            newest = try await n
            error = nil
        } catch let e {
            error = e.localizedDescription
        }
        recent = (try? await r) ?? []
        frequent = (try? await f) ?? []
        random = (try? await x) ?? []
        favorites = Array(((try? await s)?.album ?? []).shuffled().prefix(20))
        playlists = (try? await p) ?? []
        loaded = true
    }
}

/// Apple Music's tall "Top Picks" card: artwork with a colour-matched caption.
struct TopPickCard: View {
    let label: String
    let album: Album
    @State private var tint = Color(white: 0.25)

    private let width: CGFloat = 250

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label)
                .font(.footnote.weight(.semibold))
                .foregroundStyle(.secondary)
            NavigationLink(value: Route.album(album.id)) {
                VStack(spacing: 0) {
                    ArtworkView(id: album.coverArt, size: width, cornerRadius: 0)
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(album.name).font(.subheadline.weight(.semibold)).lineLimit(1)
                            Text(album.artistName).font(.subheadline).opacity(0.75).lineLimit(1)
                        }
                        Spacer()
                        Button {
                            Actions.playAlbum(album.id)
                        } label: {
                            Image(systemName: "play.fill")
                                .font(.footnote)
                                .frame(width: 32, height: 32)
                                .background(.white.opacity(0.22), in: Circle())
                        }
                        .buttonStyle(.plain)
                    }
                    .foregroundStyle(.white)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 12)
                    .frame(width: width)
                    .background(tint)
                }
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                .shadow(color: .black.opacity(0.15), radius: 8, y: 4)
            }
            .buttonStyle(.plain)
            .contextMenu { AlbumMenuItems(album: album) }
        }
        .task(id: album.coverArt) {
            guard let url = Session.shared.api?.coverURL(album.coverArt, size: 160),
                  let image = await ImageLoader.shared.image(for: url, maxPixel: 160) else { return }
            withAnimation { tint = Palette.tint(from: image) }
        }
    }
}
