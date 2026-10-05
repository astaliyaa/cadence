import SwiftUI

struct ExplicitBadge: View {
    var body: some View {
        Image(systemName: "e.square.fill")
            .font(.caption)
            .foregroundStyle(.secondary)
            .accessibilityLabel("Explicit")
    }
}

/// Animated bars marking the song that's playing.
struct NowPlayingIndicator: View {
    var playing: Bool

    var body: some View {
        Image(systemName: "waveform")
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(.tint)
            .symbolEffect(.variableColor.iterative.reversing, isActive: playing)
    }
}

/// Apple Music's wide grey Play / Shuffle buttons.
struct PillButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.body.weight(.semibold))
            .foregroundStyle(.tint)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 13)
            .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(Color(.tertiarySystemFill)))
            .opacity(configuration.isPressed ? 0.6 : 1)
    }
}

struct PlayShuffleButtons: View {
    var play: () -> Void
    var shuffle: () -> Void

    var body: some View {
        HStack(spacing: 14) {
            Button(action: play) { Label("Play", systemImage: "play.fill") }
            Button(action: shuffle) { Label("Shuffle", systemImage: "shuffle") }
        }
        .buttonStyle(PillButtonStyle())
    }
}

struct AlbumCard: View {
    let album: Album
    var width: CGFloat = 160
    var subtitle: Subtitle = .artist

    enum Subtitle { case artist, year }

    var body: some View {
        NavigationLink(value: Route.album(album.id)) {
            VStack(alignment: .leading, spacing: 6) {
                ArtworkView(id: album.coverArt, size: width, cornerRadius: 8)
                    .shadow(color: .black.opacity(0.12), radius: 4, y: 2)
                HStack(spacing: 4) {
                    Text(album.name).lineLimit(1)
                    if album.isExplicit { ExplicitBadge() }
                }
                .font(.subheadline)
                Text(subtitle == .year ? album.year.map(String.init) ?? "" : album.artistName)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            .frame(width: width, alignment: .leading)
        }
        .buttonStyle(.plain)
        .contextMenu { AlbumMenuItems(album: album) }
    }
}

/// Album card that fills its grid column.
struct AlbumGridCard: View {
    let album: Album

    var body: some View {
        NavigationLink(value: Route.album(album.id)) {
            VStack(alignment: .leading, spacing: 6) {
                FlexibleArtwork(id: album.coverArt)
                    .shadow(color: .black.opacity(0.12), radius: 4, y: 2)
                HStack(spacing: 4) {
                    Text(album.name).lineLimit(1)
                    if album.isExplicit { ExplicitBadge() }
                }
                .font(.subheadline)
                Text(album.artistName)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
        }
        .buttonStyle(.plain)
        .contextMenu { AlbumMenuItems(album: album) }
    }
}

struct ArtistCircle: View {
    let artist: Artist
    var size: CGFloat = 120

    var body: some View {
        NavigationLink(value: Route.artist(artist.id)) {
            VStack(spacing: 8) {
                ArtworkView(id: artist.imageID, size: size, circle: true, placeholderSymbol: "music.mic")
                Text(artist.name)
                    .font(.subheadline)
                    .lineLimit(1)
                    .frame(width: size)
            }
        }
        .buttonStyle(.plain)
        .contextMenu {
            Button { Actions.shuffleArtist(artist) } label: { Label("Shuffle", systemImage: "shuffle") }
            let loved = Favorites.shared.isLoved(artist.id, server: artist.starred)
            Button { Favorites.shared.toggle(.artist, id: artist.id, current: loved) } label: {
                Label(loved ? "Undo Favorite" : "Favorite", systemImage: loved ? "heart.slash" : "heart")
            }
        }
    }
}

struct PlaylistCard: View {
    let playlist: Playlist
    var width: CGFloat = 160

    var body: some View {
        NavigationLink(value: Route.playlist(playlist.id)) {
            VStack(alignment: .leading, spacing: 6) {
                ArtworkView(id: playlist.coverArt, size: width, cornerRadius: 8, placeholderSymbol: "music.note.list")
                Text(playlist.name).font(.subheadline).lineLimit(1)
                Text(Format.count(playlist.songCount ?? 0, "song"))
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            .frame(width: width, alignment: .leading)
        }
        .buttonStyle(.plain)
    }
}

/// A titled, horizontally scrolling row of cards.
struct Shelf<Content: View>: View {
    let title: String
    var route: Route?
    @ViewBuilder var content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Group {
                if let route {
                    NavigationLink(value: route) {
                        HStack(spacing: 4) {
                            Text(title).font(.title2.bold())
                            Image(systemName: "chevron.right")
                                .font(.title3.weight(.semibold))
                                .foregroundStyle(.secondary)
                        }
                    }
                    .buttonStyle(.plain)
                } else {
                    Text(title).font(.title2.bold())
                }
            }
            .padding(.horizontal)

            ScrollView(.horizontal, showsIndicators: false) {
                LazyHStack(alignment: .top, spacing: 14) {
                    content()
                }
                .scrollTargetLayout()
            }
            .contentMargins(.horizontal, 16, for: .scrollContent)
            .scrollTargetBehavior(.viewAligned)
        }
    }
}

struct ToastView: View {
    @Environment(Toast.self) private var toast

    var body: some View {
        if let message = toast.message {
            Text(message)
                .font(.subheadline.weight(.medium))
                .padding(.horizontal, 18)
                .padding(.vertical, 10)
                .background(.regularMaterial, in: Capsule())
                .shadow(color: .black.opacity(0.15), radius: 10, y: 4)
                .transition(.move(edge: .bottom).combined(with: .opacity))
        }
    }
}

struct LoadingView: View {
    var body: some View {
        ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity).padding(.vertical, 80)
    }
}
