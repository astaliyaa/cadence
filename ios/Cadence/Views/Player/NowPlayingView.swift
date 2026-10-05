import AVKit
import MediaPlayer
import SwiftUI

struct NowPlayingView: View {
    enum Mode { case artwork, lyrics, queue }

    @Environment(PlayerModel.self) private var player
    @Environment(Favorites.self) private var favorites
    @Environment(Router.self) private var router
    @Environment(\.dismiss) private var dismiss
    @State private var mode: Mode = .artwork

    var body: some View {
        @Bindable var router = router
        let song = player.current
        GeometryReader { geo in
            let artSize = min(geo.size.width - 56, geo.size.height * 0.42)
            ZStack {
                MeshBackground(coverID: song?.coverArt, animating: player.isPlaying)

                VStack(spacing: 0) {
                    grabber
                    if mode == .artwork {
                        Spacer(minLength: 12)
                        bigArtwork(song, size: artSize)
                        Spacer(minLength: 12)
                        titleRow(song)
                            .padding(.bottom, 18)
                    } else {
                        compactHeader(song)
                            .padding(.vertical, 12)
                        Group {
                            if mode == .lyrics, let song {
                                LyricsPanel(song: song)
                            } else {
                                QueuePanel()
                            }
                        }
                        .frame(maxHeight: .infinity)
                    }
                    ScrubberView()
                    TransportControls()
                        .padding(.vertical, mode == .artwork ? 22 : 12)
                    VolumeRow()
                    bottomButtons
                        .padding(.top, 18)
                }
                .padding(.horizontal, 28)
                .padding(.bottom, 6)
            }
        }
        .foregroundStyle(.white)
        .environment(\.colorScheme, .dark)
        .animation(.spring(response: 0.45, dampingFraction: 0.85), value: mode)
        .onChange(of: player.current == nil) { _, empty in if empty { dismiss() } }
        .sheet(item: $router.addToPlaylist) { batch in
            AddToPlaylistSheet(batch: batch)
        }
    }

    // MARK: pieces

    private var grabber: some View {
        Capsule()
            .fill(.white.opacity(0.45))
            .frame(width: 38, height: 5)
            .padding(.top, 8)
            .padding(.bottom, 4)
            .frame(maxWidth: .infinity)
            .contentShape(Rectangle())
            .onTapGesture { dismiss() }
            .accessibilityLabel("Close Now Playing")
            .accessibilityAddTraits(.isButton)
    }

    private func bigArtwork(_ song: Song?, size: CGFloat) -> some View {
        MotionArtworkView(albumID: song?.albumId, album: song?.album, artist: song?.albumArtistName, coverID: song?.coverArt, size: size, cornerRadius: 12)
            .shadow(color: .black.opacity(0.35), radius: player.isPlaying ? 30 : 14, y: player.isPlaying ? 18 : 8)
            .scaleEffect(player.isPlaying ? 1 : 0.78)
            .animation(.spring(response: 0.5, dampingFraction: 0.7), value: player.isPlaying)
            .frame(maxWidth: .infinity)
    }

    private func titleRow(_ song: Song?) -> some View {
        HStack(alignment: .center, spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    Text(song?.title ?? "Not Playing")
                        .font(.title3.bold())
                        .lineLimit(1)
                    if song?.isExplicit == true { ExplicitBadge() }
                }
                if let song {
                    Button {
                        if let artistID = song.artistId { Router.shared.go(.artist(artistID)) }
                    } label: {
                        Text(song.artistName)
                            .font(.title3)
                            .foregroundStyle(.white.opacity(0.65))
                            .lineLimit(1)
                    }
                    .buttonStyle(.plain)
                }
            }
            Spacer()
            if let song {
                favoriteButton(song)
                menuButton(song)
            }
        }
    }

    private func compactHeader(_ song: Song?) -> some View {
        HStack(spacing: 12) {
            Button {
                mode = .artwork
            } label: {
                ArtworkView(id: song?.coverArt, size: 62, cornerRadius: 6)
            }
            .buttonStyle(.plain)
            VStack(alignment: .leading, spacing: 2) {
                Text(song?.title ?? "Not Playing").font(.headline).lineLimit(1)
                Text(song?.artistName ?? "").font(.subheadline).foregroundStyle(.white.opacity(0.65)).lineLimit(1)
            }
            Spacer()
            if let song {
                favoriteButton(song)
                menuButton(song)
            }
        }
    }

    private func favoriteButton(_ song: Song) -> some View {
        let loved = favorites.isLoved(song.id, server: song.starred)
        return Button {
            favorites.toggle(.song, id: song.id, current: loved)
        } label: {
            Image(systemName: loved ? "star.fill" : "star")
                .font(.body.weight(.semibold))
                .frame(width: 32, height: 32)
                .background(.white.opacity(0.15), in: Circle())
                .contentTransition(.symbolEffect(.replace))
        }
        .buttonStyle(.plain)
    }

    private func menuButton(_ song: Song) -> some View {
        Menu {
            SongMenuItems(songs: [song])
        } label: {
            Image(systemName: "ellipsis")
                .font(.body.weight(.semibold))
                .frame(width: 32, height: 32)
                .background(.white.opacity(0.15), in: Circle())
        }
    }

    private var bottomButtons: some View {
        HStack {
            Spacer()
            modeButton(.lyrics, symbol: "quote.bubble", activeSymbol: "quote.bubble.fill")
            Spacer()
            AirPlayButton()
                .frame(width: 44, height: 44)
            Spacer()
            modeButton(.queue, symbol: "list.bullet", activeSymbol: "list.bullet")
            Spacer()
        }
    }

    private func modeButton(_ target: Mode, symbol: String, activeSymbol: String) -> some View {
        let active = mode == target
        return Button {
            mode = active ? .artwork : target
        } label: {
            Image(systemName: active ? activeSymbol : symbol)
                .font(.title3)
                .foregroundStyle(active ? Color.black.opacity(0.8) : Color.white.opacity(0.75))
                .frame(width: 40, height: 40)
                .background(Circle().fill(.white.opacity(active ? 0.85 : 0)))
        }
        .buttonStyle(.plain)
    }
}

/// Progress bar with drag-to-seek, Apple Music style.
struct ScrubberView: View {
    @Environment(PlayerModel.self) private var player
    @State private var dragValue: Double?

    var body: some View {
        let duration = max(player.duration, 1)
        let shown = dragValue ?? player.currentTime
        let quality = Quality.of(player.current)
        VStack(spacing: 6) {
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule().fill(.white.opacity(0.22))
                    Capsule()
                        .fill(.white.opacity(dragValue == nil ? 0.7 : 1))
                        .frame(width: max(0, geo.size.width * CGFloat(min(1, shown / duration))))
                }
                .frame(height: dragValue == nil ? 7 : 12)
                .frame(maxHeight: .infinity)
                .contentShape(Rectangle())
                .gesture(
                    DragGesture(minimumDistance: 0)
                        .onChanged { value in
                            dragValue = min(max(0, value.location.x / max(geo.size.width, 1)), 1) * duration
                        }
                        .onEnded { _ in
                            if let target = dragValue { player.seek(to: target) }
                            dragValue = nil
                        }
                )
            }
            .frame(height: 22)
            .animation(.spring(response: 0.25, dampingFraction: 0.8), value: dragValue == nil)

            ZStack {
                HStack {
                    Text(Format.time(shown))
                    Spacer()
                    Text("-" + Format.time(max(0, duration - shown)))
                }
                if let quality {
                    Label(quality.rawValue, systemImage: "waveform")
                        .font(.caption2.weight(.semibold))
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(.white.opacity(0.14), in: RoundedRectangle(cornerRadius: 4))
                }
            }
            .font(.caption.monospacedDigit().weight(.medium))
            .foregroundStyle(.white.opacity(0.6))
        }
    }
}

struct TransportControls: View {
    @Environment(PlayerModel.self) private var player

    var body: some View {
        HStack {
            Spacer()
            Button { player.previous() } label: {
                Image(systemName: "backward.fill").font(.system(size: 32))
            }
            Spacer()
            Button { player.togglePlay() } label: {
                Image(systemName: player.isPlaying ? "pause.fill" : "play.fill")
                    .font(.system(size: 46))
                    .contentTransition(.symbolEffect(.replace))
                    .frame(width: 64, height: 64)
            }
            Spacer()
            Button { player.next() } label: {
                Image(systemName: "forward.fill").font(.system(size: 32))
            }
            Spacer()
        }
        .buttonStyle(.plain)
        .disabled(player.current == nil)
    }
}

struct VolumeRow: View {
    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: "speaker.fill")
            SystemVolumeSlider()
                .frame(height: 34)
            Image(systemName: "speaker.wave.3.fill")
        }
        .font(.caption)
        .foregroundStyle(.white.opacity(0.6))
    }
}

/// The system volume slider (the only way to change device volume from an app).
struct SystemVolumeSlider: UIViewRepresentable {
    func makeUIView(context: Context) -> MPVolumeView {
        let view = MPVolumeView(frame: .zero)
        view.tintColor = .white
        if let slider = view.subviews.compactMap({ $0 as? UISlider }).first {
            slider.minimumTrackTintColor = .white
            slider.maximumTrackTintColor = UIColor.white.withAlphaComponent(0.25)
            slider.setThumbImage(Self.thumb, for: .normal)
        }
        return view
    }

    func updateUIView(_ uiView: MPVolumeView, context: Context) {}

    private static let thumb: UIImage = {
        let size = CGSize(width: 14, height: 14)
        return UIGraphicsImageRenderer(size: size).image { ctx in
            UIColor.white.setFill()
            ctx.cgContext.fillEllipse(in: CGRect(origin: .zero, size: size))
        }
    }()
}

struct AirPlayButton: UIViewRepresentable {
    func makeUIView(context: Context) -> AVRoutePickerView {
        let view = AVRoutePickerView()
        view.tintColor = UIColor.white.withAlphaComponent(0.75)
        view.activeTintColor = UIColor(Color.accentColor)
        view.prioritizesVideoDevices = false
        return view
    }

    func updateUIView(_ uiView: AVRoutePickerView, context: Context) {}
}
