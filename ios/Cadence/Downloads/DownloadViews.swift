import SwiftUI

/// A small progress ring (indeterminate when progress is unknown).
struct ProgressRing: View {
    var progress: Double?
    var lineWidth: CGFloat = 2.5
    @State private var spin = false

    var body: some View {
        ZStack {
            Circle().stroke(Color.secondary.opacity(0.25), lineWidth: lineWidth)
            Circle()
                .trim(from: 0, to: progress.map { max(0.04, min(1, $0)) } ?? 0.25)
                .stroke(Color.accentColor, style: StrokeStyle(lineWidth: lineWidth, lineCap: .round))
                .rotationEffect(.degrees(progress == nil ? (spin ? 270 : -90) : -90))
                .animation(progress == nil ? .linear(duration: 1).repeatForever(autoreverses: false) : .default, value: spin)
                .animation(.easeOut(duration: 0.3), value: progress)
        }
        .onAppear { spin = true }
    }
}

/// Downloaded / downloading marker shown on song rows.
struct DownloadIndicator: View {
    let songID: String
    @Environment(DownloadManager.self) private var downloads

    var body: some View {
        switch downloads.state(of: songID) {
        case .downloaded:
            Image(systemName: "arrow.down.circle.fill")
                .font(.caption)
                .foregroundStyle(.secondary)
                .accessibilityLabel("Downloaded")
        case .downloading(let progress):
            ProgressRing(progress: progress, lineWidth: 2)
                .frame(width: 13, height: 13)
                .accessibilityLabel("Downloading")
        case .none:
            EmptyView()
        }
    }
}

/// Toolbar button that downloads, shows progress for, or removes a set of songs.
struct DownloadButton: View {
    let songs: [Song]
    @Environment(DownloadManager.self) private var downloads
    @State private var confirmRemove = false

    var body: some View {
        let state = downloads.state(of: songs)
        Button {
            switch state {
            case .none: downloads.download(songs)
            case .downloading: downloads.cancelDownloads(songs)
            case .downloaded: confirmRemove = true
            }
        } label: {
            switch state {
            case .none:
                Image(systemName: "arrow.down.circle")
            case .downloading(let progress):
                ProgressRing(progress: progress).frame(width: 20, height: 20)
            case .downloaded:
                Image(systemName: "arrow.down.circle.fill")
            }
        }
        .disabled(songs.isEmpty)
        .accessibilityLabel(state == .downloaded ? "Remove Download" : state == .none ? "Download" : "Stop Downloading")
        .confirmationDialog("Remove Download?", isPresented: $confirmRemove, titleVisibility: .visible) {
            Button("Remove Download", role: .destructive) { downloads.remove(songs) }
        } message: {
            Text("These songs stay in your library and can still be streamed.")
        }
    }
}

// MARK: - Downloaded section (works offline)

struct LocalAlbum: Identifiable, Hashable {
    let id: String
    let name: String
    let artist: String
    let coverArt: String?
    let songs: [Song]
}

extension DownloadManager {
    var downloadedSongs: [Song] {
        downloaded.values.map(\.song).sorted {
            ($0.albumArtistName.lowercased(), ($0.album ?? "").lowercased(), $0.discNumber ?? 1, $0.track ?? 0)
                < ($1.albumArtistName.lowercased(), ($1.album ?? "").lowercased(), $1.discNumber ?? 1, $1.track ?? 0)
        }
    }

    var downloadedAlbums: [LocalAlbum] {
        let groups = Dictionary(grouping: downloadedSongs) { $0.albumId ?? $0.album ?? "unknown" }
        return groups.map { key, songs in
            let first = songs[0]
            return LocalAlbum(id: key, name: first.album ?? "Unknown Album", artist: first.albumArtistName, coverArt: first.coverArt, songs: songs)
        }
        .sorted { ($0.artist.lowercased(), $0.name.lowercased()) < ($1.artist.lowercased(), $1.name.lowercased()) }
    }
}

struct DownloadedView: View {
    enum Kind: String, CaseIterable { case albums = "Albums", songs = "Songs" }

    @Environment(DownloadManager.self) private var downloads
    @Environment(PlayerModel.self) private var player
    @State private var kind: Kind = .albums
    private let columns = [GridItem(.flexible(), spacing: 16), GridItem(.flexible(), spacing: 16)]

    var body: some View {
        let songs = downloads.downloadedSongs
        List {
            if songs.isEmpty {
                ContentUnavailableView("No Downloads", systemImage: "arrow.down.circle",
                                       description: Text("Download albums and playlists to listen without a connection."))
                    .listRowSeparator(.hidden)
            } else {
                VStack(spacing: 12) {
                    Picker("Show", selection: $kind) {
                        ForEach(Kind.allCases, id: \.self) { Text($0.rawValue).tag($0) }
                    }
                    .pickerStyle(.segmented)
                    Text("\(Format.count(songs.count, "song")) · \(ByteCountFormatter.string(fromByteCount: downloads.totalBytes, countStyle: .file))")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                    PlayShuffleButtons(
                        play: { player.play(songs, source: "Downloads") },
                        shuffle: { player.play(songs, shuffle: true, source: "Downloads") }
                    )
                    .buttonStyle(.borderless)
                }
                .listRowSeparator(.hidden)

                switch kind {
                case .albums:
                    LazyVGrid(columns: columns, spacing: 20) {
                        ForEach(downloads.downloadedAlbums) { album in
                            NavigationLink(value: Route.downloadedAlbum(album.id)) {
                                VStack(alignment: .leading, spacing: 6) {
                                    FlexibleArtwork(id: album.coverArt)
                                    Text(album.name).font(.subheadline).lineLimit(1)
                                    Text(album.artist).font(.subheadline).foregroundStyle(.secondary).lineLimit(1)
                                }
                            }
                            .buttonStyle(.plain)
                            .contextMenu {
                                Button(role: .destructive) { downloads.remove(album.songs) } label: {
                                    Label("Remove Download", systemImage: "trash")
                                }
                            }
                        }
                    }
                    .listRowSeparator(.hidden)
                case .songs:
                    ForEach(Array(songs.enumerated()), id: \.element.id) { i, song in
                        SongRow(song: song, onTap: { player.play(songs, startAt: i, source: "Downloads") })
                            .swipeActions(edge: .trailing) {
                                Button(role: .destructive) { downloads.remove([song]) } label: {
                                    Label("Remove", systemImage: "trash")
                                }
                            }
                    }
                }
            }
        }
        .listStyle(.plain)
        .navigationTitle("Downloaded")
    }
}

struct DownloadedAlbumView: View {
    let albumKey: String
    @Environment(DownloadManager.self) private var downloads
    @Environment(PlayerModel.self) private var player
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        if let album = downloads.downloadedAlbums.first(where: { $0.id == albumKey }) {
            List {
                VStack(spacing: 6) {
                    ArtworkView(id: album.coverArt, size: 240, cornerRadius: 10, large: true)
                        .shadow(color: .black.opacity(0.25), radius: 16, y: 8)
                        .padding(.bottom, 12)
                    Text(album.name).font(.title2.bold()).multilineTextAlignment(.center)
                    Text(album.artist).font(.title3).foregroundStyle(.tint)
                    PlayShuffleButtons(
                        play: { player.play(album.songs, source: album.name) },
                        shuffle: { player.play(album.songs, shuffle: true, source: album.name) }
                    )
                    .buttonStyle(.borderless)
                    .padding(.top, 12)
                }
                .frame(maxWidth: .infinity)
                .listRowSeparator(.hidden)

                ForEach(Array(album.songs.enumerated()), id: \.element.id) { i, song in
                    SongRow(song: song, trackNumber: song.track ?? i + 1, showArtist: song.artistName != album.artist,
                            onTap: { player.play(album.songs, startAt: i, source: album.name) })
                        .swipeActions(edge: .trailing) {
                            Button(role: .destructive) { downloads.remove([song]) } label: { Label("Remove", systemImage: "trash") }
                        }
                }
            }
            .listStyle(.plain)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button(role: .destructive) {
                        downloads.remove(album.songs)
                        dismiss()
                    } label: {
                        Image(systemName: "trash")
                    }
                    .accessibilityLabel("Remove Download")
                }
            }
        } else {
            ContentUnavailableView("Not Downloaded", systemImage: "arrow.down.circle")
        }
    }
}

/// Settings section: storage, quality, and the "download everything" button.
struct DownloadSettingsSection: View {
    @Environment(DownloadManager.self) private var downloads
    @Environment(AppSettings.self) private var settings
    @State private var estimate: DownloadManager.LibraryEstimate?
    @State private var confirmLibrary = false
    @State private var confirmRemoveAll = false
    @State private var errorText: String?

    var body: some View {
        @Bindable var settings = settings
        Section {
            LabeledContent("Downloaded", value: "\(Format.count(downloads.downloaded.count, "song")) · \(ByteCountFormatter.string(fromByteCount: downloads.totalBytes, countStyle: .file))")
            if !downloads.active.isEmpty {
                VStack(alignment: .leading, spacing: 6) {
                    HStack {
                        Text("Downloading \(downloads.active.count.formatted()) song\(downloads.active.count == 1 ? "" : "s")…")
                        Spacer()
                        Button("Stop", role: .destructive) { downloads.cancelAll() }
                            .buttonStyle(.borderless)
                    }
                    ProgressView(value: downloads.batchProgress)
                }
            }
            if downloads.failed > 0 {
                Text("\(downloads.failed) download\(downloads.failed == 1 ? "" : "s") failed. Try again later.")
                    .font(.footnote)
                    .foregroundStyle(.orange)
            }
            Picker("Download Quality", selection: $settings.downloadQuality) {
                ForEach(DownloadQuality.allCases) { Text($0.title).tag($0) }
            }
            Toggle("Download over Cellular", isOn: $settings.downloadOverCellular)
            Button {
                Task { await prepareLibrary() }
            } label: {
                HStack {
                    Text("Download Entire Library…")
                    Spacer()
                    if downloads.preparingLibrary { ProgressView() }
                }
            }
            .disabled(downloads.preparingLibrary)
            if let errorText {
                Text(errorText).font(.footnote).foregroundStyle(.orange)
            }
            if !downloads.downloaded.isEmpty {
                Button("Remove All Downloads", role: .destructive) { confirmRemoveAll = true }
            }
        } header: {
            Text("Downloads")
        } footer: {
            Text("Downloads continue in the background, even when Cadence is closed. Original keeps your files exactly as they are on the server (formats the iPhone can't play are converted to 320 kbps MP3).")
        }
        .confirmationDialog(libraryTitle, isPresented: $confirmLibrary, titleVisibility: .visible) {
            Button("Download \(Format.count(estimate?.songs.count ?? 0, "Song"))") {
                if let songs = estimate?.songs { downloads.download(songs) }
            }
        } message: {
            Text(libraryMessage)
        }
        .confirmationDialog("Remove all downloads?", isPresented: $confirmRemoveAll, titleVisibility: .visible) {
            Button("Remove All Downloads", role: .destructive) { downloads.removeAll() }
        } message: {
            Text("Songs stay in your library and can still be streamed.")
        }
    }

    private var libraryTitle: String {
        guard let estimate else { return "Download Entire Library?" }
        return estimate.songs.isEmpty ? "Everything Is Downloaded" : "Download Entire Library?"
    }

    private var libraryMessage: String {
        guard let estimate else { return "" }
        if estimate.songs.isEmpty { return "Every song in your library is already on this iPhone." }
        var text = "\(Format.count(estimate.songs.count, "song")) not yet downloaded, about \(ByteCountFormatter.string(fromByteCount: estimate.bytes, countStyle: .file))."
        if let free = estimate.freeBytes {
            text += " \(ByteCountFormatter.string(fromByteCount: free, countStyle: .file)) free on this iPhone."
            if free < estimate.bytes { text += " That isn't enough space for everything." }
        }
        if !settings.downloadOverCellular { text += " Downloads use Wi-Fi only." }
        return text
    }

    private func prepareLibrary() async {
        errorText = nil
        do {
            estimate = try await downloads.estimateLibrary()
            confirmLibrary = true
        } catch {
            errorText = "Couldn't list your library: \(error.localizedDescription)"
        }
    }
}
