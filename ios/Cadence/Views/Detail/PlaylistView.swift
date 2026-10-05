import SwiftUI

struct PlaylistView: View {
    let id: String

    @Environment(PlayerModel.self) private var player
    @Environment(\.dismiss) private var dismiss
    @State private var playlist: Playlist?
    @State private var error: String?
    @State private var renaming = false
    @State private var newName = ""
    @State private var confirmDelete = false

    var body: some View {
        Group {
            if let playlist {
                content(playlist)
            } else if let error {
                ContentUnavailableView("Couldn't Load Playlist", systemImage: "exclamationmark.triangle", description: Text(error))
            } else {
                LoadingView()
            }
        }
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .onReceive(NotificationCenter.default.publisher(for: .playlistChanged)) { note in
            if note.object as? String == id { Task { await load() } }
        }
    }

    private var editable: Bool {
        guard let playlist else { return false }
        return playlist.readonly != true && (playlist.owner == nil || playlist.owner == Session.shared.api?.creds.username)
    }

    private func content(_ playlist: Playlist) -> some View {
        let songs = playlist.entry ?? []
        return List {
            VStack(spacing: 6) {
                ArtworkView(id: playlist.coverArt, size: 240, cornerRadius: 10, large: true, placeholderSymbol: "music.note.list")
                    .shadow(color: .black.opacity(0.25), radius: 16, y: 8)
                    .padding(.bottom, 12)
                Text(playlist.name).font(.title2.bold()).multilineTextAlignment(.center)
                if let owner = playlist.owner {
                    Text(owner).font(.title3).foregroundStyle(.tint)
                }
                if let comment = playlist.comment, !comment.isEmpty {
                    Text(comment).font(.subheadline).foregroundStyle(.secondary).multilineTextAlignment(.center)
                }
                Text("\(Format.count(playlist.songCount ?? songs.count, "song")) · \(Format.longDuration(playlist.duration ?? 0))")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
                PlayShuffleButtons(
                    play: { player.play(songs, source: playlist.name) },
                    shuffle: { player.play(songs, shuffle: true, source: playlist.name) }
                )
                .buttonStyle(.borderless)
                .padding(.top, 12)
            }
            .frame(maxWidth: .infinity)
            .listRowSeparator(.hidden)
            .padding(.vertical, 8)

            if songs.isEmpty {
                ContentUnavailableView("Empty Playlist", systemImage: "music.note.list",
                                       description: Text("Long-press any song and choose “Add to Playlist”."))
                    .listRowSeparator(.hidden)
            }

            ForEach(Array(songs.enumerated()), id: \.offset) { i, song in
                SongRow(song: song, playlistContext: editable ? (playlist: playlist, index: i) : nil, onTap: {
                    player.play(songs, startAt: i, source: playlist.name)
                })
                .songSwipeActions(song)
            }
            .onDelete(perform: editable ? remove : nil)
        }
        .listStyle(.plain)
        .refreshable { await load(force: true) }
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                DownloadButton(songs: songs)
            }
            if editable {
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        Button { newName = playlist.name; renaming = true } label: { Label("Rename", systemImage: "pencil") }
                        Button(role: .destructive) { confirmDelete = true } label: { Label("Delete Playlist", systemImage: "trash") }
                    } label: {
                        Image(systemName: "ellipsis.circle")
                    }
                }
            }
        }
        .alert("Rename Playlist", isPresented: $renaming) {
            TextField("Name", text: $newName)
            Button("Cancel", role: .cancel) {}
            Button("Save") { Task { await rename() } }
        }
        .confirmationDialog("Delete “\(playlist.name)”?", isPresented: $confirmDelete, titleVisibility: .visible) {
            Button("Delete Playlist", role: .destructive) { Task { await delete() } }
        } message: {
            Text("Songs stay in your library.")
        }
    }

    private func load(force: Bool = false) async {
        guard force || playlist == nil, let api = Session.shared.api else { return }
        do {
            playlist = try await api.playlist(id)
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func remove(_ offsets: IndexSet) {
        Task {
            try? await Session.shared.api?.updatePlaylist(id: id, removeIndexes: Array(offsets))
            await load(force: true)
        }
    }

    private func rename() async {
        let name = newName.trimmingCharacters(in: .whitespaces)
        guard !name.isEmpty else { return }
        try? await Session.shared.api?.updatePlaylist(id: id, name: name)
        await load(force: true)
    }

    private func delete() async {
        try? await Session.shared.api?.deletePlaylist(id)
        dismiss()
    }
}
