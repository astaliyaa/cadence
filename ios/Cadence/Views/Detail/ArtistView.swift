import SwiftUI

struct ArtistView: View {
    let id: String

    @Environment(PlayerModel.self) private var player
    @Environment(Favorites.self) private var favorites
    @State private var artist: Artist?
    @State private var info: ArtistInfo?
    @State private var topSongs: [Song] = []
    @State private var error: String?
    @State private var bioExpanded = false

    var body: some View {
        Group {
            if let artist {
                content(artist)
            } else if let error {
                ContentUnavailableView("Couldn't Load Artist", systemImage: "exclamationmark.triangle", description: Text(error))
            } else {
                LoadingView()
            }
        }
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
    }

    private func content(_ artist: Artist) -> some View {
        let albums = (artist.album ?? []).sorted { ($0.year ?? 0) > ($1.year ?? 0) }
        let singles = albums.filter(\.isSingleOrEP)
        let compilations = albums.filter { !$0.isSingleOrEP && $0.isCompilationRelease }
        let main = albums.filter { !$0.isSingleOrEP && !$0.isCompilationRelease }

        return ScrollView {
            VStack(alignment: .leading, spacing: 28) {
                hero(artist, fallbackCover: main.first?.coverArt ?? albums.first?.coverArt)

                if !topSongs.isEmpty {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Top Songs").font(.title2.bold()).padding(.horizontal)
                        ForEach(Array(topSongs.prefix(5).enumerated()), id: \.element.id) { i, song in
                            SongRow(song: song, showArtist: false, onTap: {
                                player.play(topSongs, startAt: i, source: "\(artist.name) — Top Songs")
                            })
                            .padding(.horizontal)
                            .contextMenu { SongMenuItems(songs: [song]) }
                        }
                    }
                }

                if !main.isEmpty {
                    Shelf(title: "Albums") { ForEach(main) { AlbumCard(album: $0, subtitle: .year) } }
                }
                if !singles.isEmpty {
                    Shelf(title: "Singles & EPs") { ForEach(singles) { AlbumCard(album: $0, subtitle: .year) } }
                }
                if !compilations.isEmpty {
                    Shelf(title: "Compilations") { ForEach(compilations) { AlbumCard(album: $0, subtitle: .year) } }
                }

                if let bio = info?.biography.map(Format.stripHTML), !bio.isEmpty {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("About").font(.title2.bold())
                        Text(bio)
                            .font(.callout)
                            .foregroundStyle(.secondary)
                            .lineLimit(bioExpanded ? nil : 5)
                        Button(bioExpanded ? "Less" : "More") { withAnimation { bioExpanded.toggle() } }
                            .font(.callout.weight(.semibold))
                    }
                    .padding(.horizontal)
                }

                if let similar = info?.similarArtist, !similar.isEmpty {
                    Shelf(title: "Similar Artists") { ForEach(similar) { ArtistCircle(artist: $0) } }
                }
            }
            .padding(.bottom, 24)
        }
        .ignoresSafeArea(edges: .top)
        .toolbar {
            ToolbarItemGroup(placement: .topBarTrailing) {
                let loved = favorites.isLoved(artist.id, server: artist.starred)
                Button { favorites.toggle(.artist, id: artist.id, current: loved) } label: {
                    Image(systemName: loved ? "heart.fill" : "heart")
                }
            }
        }
    }

    private func hero(_ artist: Artist, fallbackCover: String?) -> some View {
        GeometryReader { geo in
            let width = geo.size.width
            ZStack(alignment: .bottomLeading) {
                HeroImage(primaryID: artist.imageID, fallbackID: fallbackCover, width: width, height: 360)
                LinearGradient(colors: [.clear, .black.opacity(0.55)], startPoint: .center, endPoint: .bottom)
                HStack(alignment: .bottom) {
                    Text(artist.name)
                        .font(.system(size: 34, weight: .heavy))
                        .foregroundStyle(.white)
                        .lineLimit(2)
                        .minimumScaleFactor(0.6)
                    Spacer()
                    Button {
                        Actions.shuffleArtist(artist)
                    } label: {
                        Image(systemName: "play.fill")
                            .font(.title3)
                            .foregroundStyle(.white)
                            .frame(width: 48, height: 48)
                            .background(Circle().fill(Color.accentColor))
                            .shadow(radius: 6)
                    }
                    .buttonStyle(.plain)
                }
                .padding(.horizontal)
                .padding(.bottom, 18)
            }
            .frame(width: width, height: 360)
            .clipped()
        }
        .frame(height: 360)
    }

    private func load() async {
        guard artist == nil, let api = Session.shared.api else { return }
        do {
            let loaded = try await DataCache.shared.load("artist:\(id)") { try await api.artist(id) }
            artist = loaded
            async let infoTask = api.artistInfo(id)
            async let topTask = api.topSongs(loaded.name, count: 10)
            info = try? await infoTask
            topSongs = (try? await topTask) ?? []
        } catch {
            self.error = error.localizedDescription
        }
    }
}

/// A wide image that fills its frame; falls back to a blurred album cover.
struct HeroImage: View {
    let primaryID: String
    let fallbackID: String?
    let width: CGFloat
    let height: CGFloat

    @Environment(\.displayScale) private var displayScale
    @State private var image: UIImage?
    @State private var usingFallback = false

    var body: some View {
        ZStack {
            Color(.systemGray5)
            if let image {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFill()
                    .frame(width: width, height: height)
                    .blur(radius: usingFallback ? 30 : 0)
                    .clipped()
                    .transition(.opacity)
            }
        }
        .frame(width: width, height: height)
        .task(id: primaryID) {
            guard let api = Session.shared.api else { return }
            let px = CGFloat(ArtSize.pixels(for: max(width, height), scale: displayScale, quality: AppSettings.shared.artworkQuality))
            if let url = api.coverURL(primaryID, size: Int(px)), let img = await ImageLoader.shared.image(for: url, maxPixel: px) {
                withAnimation { image = img }
            } else if let fallbackID, let url = api.coverURL(fallbackID, size: 300),
                      let img = await ImageLoader.shared.image(for: url, maxPixel: 300) {
                usingFallback = true
                withAnimation { image = img }
            }
        }
    }
}
