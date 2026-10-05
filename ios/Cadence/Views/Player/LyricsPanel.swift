import SwiftUI

/// Synced lyrics that scroll with the song, Apple Music style: the current line
/// is bright, the rest dimmed and softly blurred; tap a line to jump to it.
struct LyricsPanel: View {
    let song: Song

    @Environment(PlayerModel.self) private var player
    @State private var doc: LyricsDoc?
    @State private var loading = true
    @State private var userScrolling = false
    @State private var resumeTask: Task<Void, Never>?

    private static let lead = 0.25

    var body: some View {
        Group {
            if loading {
                ProgressView().tint(.white).frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if let doc, doc.lines.contains(where: { !$0.text.isEmpty }) {
                if doc.synced { synced(doc) } else { plain(doc) }
            } else {
                Text("Lyrics aren't available for this song.")
                    .font(.title3.bold())
                    .foregroundStyle(.white.opacity(0.6))
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .task(id: song.id) {
            loading = true
            doc = await LyricsService.shared.lyrics(for: song)
            loading = false
        }
    }

    private func activeIndex(_ lines: [LyricsLine]) -> Int {
        let t = player.currentTime + Self.lead
        var lo = 0, hi = lines.count - 1, ans = -1
        while lo <= hi {
            let mid = (lo + hi) / 2
            if lines[mid].time <= t { ans = mid; lo = mid + 1 } else { hi = mid - 1 }
        }
        return ans
    }

    private func synced(_ doc: LyricsDoc) -> some View {
        let active = activeIndex(doc.lines)
        return ScrollViewReader { proxy in
            ScrollView(showsIndicators: false) {
                VStack(alignment: .leading, spacing: 22) {
                    Color.clear.frame(height: 80)
                    ForEach(doc.lines) { line in
                        let distance = line.id - active
                        lineView(line, isActive: distance == 0, distance: distance)
                            .id(line.id)
                            .onTapGesture {
                                player.seek(to: line.time)
                                player.resume()
                                userScrolling = false
                            }
                    }
                    Color.clear.frame(height: 360)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .simultaneousGesture(DragGesture().onChanged { _ in userIsScrolling() })
            .onChange(of: active) { _, newValue in
                guard !userScrolling, newValue >= 0 else { return }
                withAnimation(.spring(response: 0.7, dampingFraction: 0.85)) {
                    proxy.scrollTo(newValue, anchor: UnitPoint(x: 0, y: 0.2))
                }
            }
            .onAppear {
                if active >= 0 { proxy.scrollTo(active, anchor: UnitPoint(x: 0, y: 0.2)) }
            }
        }
        .mask(
            LinearGradient(
                stops: [.init(color: .clear, location: 0), .init(color: .black, location: 0.08),
                        .init(color: .black, location: 0.82), .init(color: .clear, location: 1)],
                startPoint: .top, endPoint: .bottom
            )
        )
    }

    @ViewBuilder
    private func lineView(_ line: LyricsLine, isActive: Bool, distance: Int) -> some View {
        Group {
            if line.isGap {
                HStack(spacing: 8) {
                    ForEach(0..<3, id: \.self) { _ in Circle().frame(width: 9, height: 9) }
                }
                .scaleEffect(isActive ? 1.15 : 1, anchor: .leading)
                .animation(isActive ? .easeInOut(duration: 1.2).repeatForever(autoreverses: true) : .default, value: isActive)
            } else {
                Text(line.text)
                    .font(.system(size: 30, weight: .bold))
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .foregroundStyle(.white.opacity(isActive ? 1 : 0.35))
        .blur(radius: userScrolling || isActive ? 0 : min(Double(abs(distance)), 4) * 0.7)
        .scaleEffect(isActive ? 1 : 0.97, anchor: .leading)
        .animation(.spring(response: 0.5, dampingFraction: 0.8), value: isActive)
    }

    private func plain(_ doc: LyricsDoc) -> some View {
        ScrollView(showsIndicators: false) {
            VStack(alignment: .leading, spacing: 6) {
                ForEach(doc.lines) { line in
                    Text(line.text.isEmpty ? " " : line.text)
                        .font(.system(size: 24, weight: .bold))
                }
                Text("Lyrics from \(doc.source)")
                    .font(.footnote.weight(.medium))
                    .foregroundStyle(.white.opacity(0.5))
                    .padding(.top, 20)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.vertical, 20)
        }
    }

    private func userIsScrolling() {
        userScrolling = true
        resumeTask?.cancel()
        resumeTask = Task {
            try? await Task.sleep(for: .seconds(3))
            if !Task.isCancelled { userScrolling = false }
        }
    }
}

/// "Playing Next" list with shuffle / repeat / autoplay toggles and drag to reorder.
struct QueuePanel: View {
    @Environment(PlayerModel.self) private var player
    @Environment(AppSettings.self) private var settings
    @State private var showHistory = false

    var body: some View {
        VStack(spacing: 12) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(showHistory ? "History" : "Playing Next").font(.headline)
                    if !showHistory, let source = player.sourceName {
                        Text("From \(source)").font(.caption).foregroundStyle(.white.opacity(0.6)).lineLimit(1)
                    }
                }
                Spacer()
                Button { showHistory.toggle() } label: {
                    Image(systemName: "clock.arrow.circlepath")
                        .foregroundStyle(showHistory ? Color.black.opacity(0.8) : Color.white.opacity(0.8))
                        .frame(width: 34, height: 30)
                        .background(Capsule().fill(.white.opacity(showHistory ? 0.85 : 0.15)))
                }
                .buttonStyle(.plain)
            }

            if !showHistory {
                HStack(spacing: 10) {
                    toggle("shuffle", on: player.shuffle) { player.toggleShuffle() }
                    toggle(player.repeatMode == .one ? "repeat.1" : "repeat", on: player.repeatMode != .off) { player.cycleRepeat() }
                    toggle("infinity", on: settings.autoplay) { settings.autoplay.toggle() }
                }
            }

            List {
                if showHistory {
                    ForEach(player.history) { item in
                        queueRow(item).onTapGesture {
                            if let i = player.queue.firstIndex(of: item) { player.jump(to: i) }
                        }
                    }
                } else {
                    ForEach(player.upcoming) { item in
                        queueRow(item)
                            .onTapGesture {
                                if let i = player.queue.firstIndex(of: item) { player.jump(to: i) }
                            }
                            .swipeActions {
                                Button(role: .destructive) { player.remove(item) } label: { Label("Remove", systemImage: "trash") }
                            }
                    }
                    .onMove { from, to in player.moveUpcoming(from: from, to: to) }
                }
            }
            .listStyle(.plain)
            .scrollContentBackground(.hidden)
            .overlay {
                if (showHistory ? player.history : player.upcoming).isEmpty {
                    Text(showHistory ? "Songs you play will show up here." : "Nothing queued up.")
                        .font(.subheadline)
                        .foregroundStyle(.white.opacity(0.6))
                }
            }
        }
    }

    private func toggle(_ symbol: String, on: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.body.weight(.semibold))
                .foregroundStyle(on ? Color.black.opacity(0.8) : Color.white.opacity(0.85))
                .frame(maxWidth: .infinity)
                .frame(height: 34)
                .background(RoundedRectangle(cornerRadius: 9, style: .continuous).fill(.white.opacity(on ? 0.85 : 0.15)))
        }
        .buttonStyle(.plain)
    }

    private func queueRow(_ item: QueueItem) -> some View {
        HStack(spacing: 12) {
            ArtworkView(id: item.song.coverArt, size: 44, cornerRadius: 5)
            VStack(alignment: .leading, spacing: 2) {
                Text(item.song.title).lineLimit(1)
                Text(item.song.artistName).font(.subheadline).foregroundStyle(.white.opacity(0.6)).lineLimit(1)
            }
            Spacer()
            if item.autoplay {
                Image(systemName: "infinity").font(.caption).foregroundStyle(.white.opacity(0.5))
            }
        }
        .contentShape(Rectangle())
        .listRowBackground(Color.clear)
        .listRowSeparatorTint(.white.opacity(0.15))
        .listRowInsets(EdgeInsets(top: 6, leading: 0, bottom: 6, trailing: 0))
    }
}
