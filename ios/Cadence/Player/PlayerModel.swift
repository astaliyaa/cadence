import AVFoundation
import MediaPlayer
import Network
import Observation
import UIKit

struct QueueItem: Codable, Identifiable, Hashable {
    var id = UUID()
    let song: Song
    /// Added by Autoplay rather than by the user.
    var autoplay = false
}

enum RepeatMode: String, Codable {
    case off, all, one
}

/// Playback engine and queue. AVQueuePlayer always holds the current track plus
/// the next one, so tracks change without a gap.
@Observable
@MainActor
final class PlayerModel {
    static let shared = PlayerModel()

    // MARK: observable state

    private(set) var queue: [QueueItem] = []
    private(set) var index = -1
    private(set) var isPlaying = false
    private(set) var isBuffering = false
    private(set) var currentTime: Double = 0
    private(set) var duration: Double = 0
    private(set) var shuffle = false
    private(set) var sourceName: String?
    private(set) var lastError: String?
    var repeatMode: RepeatMode = .off {
        didSet { syncUpcoming(); save() }
    }

    var current: Song? { queue.indices.contains(index) ? queue[index].song : nil }
    var currentItem: QueueItem? { queue.indices.contains(index) ? queue[index] : nil }
    var upcoming: [QueueItem] { index + 1 < queue.count ? Array(queue[(index + 1)...]) : [] }
    var history: [QueueItem] { index > 0 ? Array(queue[..<index].reversed()) : [] }

    // MARK: internals

    @ObservationIgnored private var originalQueue: [QueueItem]?
    private let player = AVQueuePlayer()
    @ObservationIgnored private var itemIDs: [ObjectIdentifier: UUID] = [:]
    @ObservationIgnored private var itemObservers: [ObjectIdentifier: NSKeyValueObservation] = [:]
    @ObservationIgnored private var playerObservers: [NSKeyValueObservation] = []
    @ObservationIgnored private var timeObserver: Any?
    @ObservationIgnored private var reloading = false
    @ObservationIgnored private var listened: Double = 0
    @ObservationIgnored private var lastTick: Double = 0
    @ObservationIgnored private var scrobbled = false
    @ObservationIgnored private var nowPlayingSent = false
    @ObservationIgnored private var startedAt = Date()
    @ObservationIgnored private var fallbackFor: String?
    @ObservationIgnored private var errorStreak = 0
    @ObservationIgnored private var autoplayLoading = false
    @ObservationIgnored private var onCellular = false
    @ObservationIgnored private var lastPositionSave = Date.distantPast
    @ObservationIgnored private var artwork: MPMediaItemArtwork?
    @ObservationIgnored private var artworkFor: String?
    private let pathMonitor = NWPathMonitor()

    private var settings: AppSettings { AppSettings.shared }

    private init() {
        player.automaticallyWaitsToMinimizeStalling = true
        observePlayer()
        setUpRemoteCommands()
        observeSystemEvents()
        pathMonitor.pathUpdateHandler = { [weak self] path in
            let cellular = path.usesInterfaceType(.cellular) && !path.usesInterfaceType(.wifi)
            Task { @MainActor in self?.onCellular = cellular }
        }
        pathMonitor.start(queue: DispatchQueue(label: "cadence.network"))
        restore()
    }

    // MARK: - Starting playback

    func play(_ songs: [Song], startAt start: Int = 0, shuffle shuffleRequested: Bool? = nil, source: String? = nil) {
        guard !songs.isEmpty else { return }
        let ordered = songs.map { QueueItem(song: $0) }
        let startIndex = min(max(start, 0), songs.count - 1)
        // An explicit Shuffle randomises everything; if shuffle mode is already on,
        // the tapped song plays first and the rest is shuffled behind it.
        let explicit = shuffleRequested == true
        let useShuffle = shuffleRequested ?? shuffle
        if useShuffle {
            let first = explicit ? nil : ordered[startIndex]
            let rest = ordered.filter { $0.id != first?.id }.shuffled()
            queue = (first.map { [$0] } ?? []) + rest
            originalQueue = ordered
            index = 0
        } else {
            queue = ordered
            originalQueue = nil
            index = startIndex
        }
        shuffle = useShuffle
        sourceName = source
        errorStreak = 0
        lastError = nil
        loadCurrent(autoplay: true)
    }

    func playNext(_ songs: [Song]) {
        guard !songs.isEmpty else { return }
        guard currentItem != nil else { return play(songs) }
        let items = songs.map { QueueItem(song: $0) }
        queue.insert(contentsOf: items, at: index + 1)
        if var original = originalQueue, let at = original.firstIndex(where: { $0.id == queue[index].id }) {
            original.insert(contentsOf: items, at: at + 1)
            originalQueue = original
        }
        syncUpcoming()
        save()
    }

    func addToQueue(_ songs: [Song]) {
        guard !songs.isEmpty else { return }
        guard currentItem != nil else { return play(songs) }
        let items = songs.map { QueueItem(song: $0) }
        // Keep what the user adds ahead of Autoplay suggestions.
        let firstAuto = queue.indices.first { $0 > index && queue[$0].autoplay } ?? queue.count
        queue.insert(contentsOf: items, at: firstAuto)
        originalQueue?.append(contentsOf: items)
        syncUpcoming()
        save()
    }

    func jump(to i: Int) {
        guard queue.indices.contains(i) else { return }
        index = i
        loadCurrent(autoplay: true)
    }

    /// Removes an upcoming or past item (not the current one).
    func remove(_ item: QueueItem) {
        guard let i = queue.firstIndex(of: item), i != index else { return }
        queue.remove(at: i)
        originalQueue?.removeAll { $0.id == item.id }
        if i < index { index -= 1 }
        syncUpcoming()
        save()
    }

    /// Reorders the "Playing Next" list (offsets are relative to `upcoming`).
    func moveUpcoming(from source: IndexSet, to destination: Int) {
        var up = upcoming
        up.move(fromOffsets: source, toOffset: destination)
        queue.replaceSubrange((index + 1)..., with: up)
        syncUpcoming()
        save()
    }

    func clearUpcoming() {
        guard index >= 0 else { return }
        let keep = Set(queue[...index].map(\.id))
        queue = Array(queue[...index])
        originalQueue = originalQueue?.filter { keep.contains($0.id) }
        syncUpcoming()
        save()
    }

    // MARK: - Transport

    func togglePlay() {
        isPlaying ? pause() : resume()
    }

    func resume() {
        guard currentItem != nil else { return }
        if player.currentItem == nil {
            loadCurrent(autoplay: true, startAt: UserDefaults.standard.double(forKey: Self.positionKey))
            return
        }
        activateAudioSession()
        player.play()
    }

    func pause() {
        player.pause()
        savePosition(force: true)
    }

    func next() {
        errorStreak = 0
        advance(userInitiated: true)
    }

    func previous() {
        if currentTime > 3 || index <= 0 {
            seek(to: 0)
            return
        }
        index -= 1
        loadCurrent(autoplay: isPlaying || player.rate > 0)
    }

    func seek(to seconds: Double) {
        let t = max(0, min(seconds, duration > 0 ? duration - 0.5 : seconds))
        currentTime = t
        lastTick = t
        player.seek(to: CMTime(seconds: t, preferredTimescale: 600), toleranceBefore: .zero, toleranceAfter: .zero) { [weak self] _ in
            Task { @MainActor in self?.updateNowPlayingInfo() }
        }
    }

    func toggleShuffle() {
        if !shuffle {
            originalQueue = queue
            let head = Array(queue.prefix(index + 1))
            let rest = Array(queue.dropFirst(index + 1)).shuffled()
            queue = head + rest
            shuffle = true
        } else {
            let base = originalQueue ?? queue
            let currentID = currentItem?.id
            queue = base
            index = base.firstIndex { $0.id == currentID } ?? index
            originalQueue = nil
            shuffle = false
        }
        syncUpcoming()
        save()
    }

    func cycleRepeat() {
        repeatMode = switch repeatMode {
        case .off: .all
        case .all: .one
        case .one: .off
        }
    }

    // MARK: - Engine

    private func streamURL(for song: Song, forceTranscode: Bool = false) -> URL? {
        guard let api = Session.shared.api else { return nil }
        // Formats AVPlayer can't decode get transcoded by Navidrome.
        let unsupported: Set<String> = ["ogg", "oga", "opus", "wma", "ape", "wv", "dsf", "dff", "mpc", "webm"]
        let quality = onCellular ? settings.cellularQuality : settings.wifiQuality
        var (format, bitrate) = quality.params
        if forceTranscode || unsupported.contains((song.suffix ?? "").lowercased()) {
            if format == "raw" {
                format = "mp3"
                bitrate = 320
            }
        }
        return api.streamURL(songID: song.id, format: format, maxBitRate: bitrate)
    }

    private func makeItem(for queueItem: QueueItem, forceTranscode: Bool = false) -> AVPlayerItem? {
        guard let url = streamURL(for: queueItem.song, forceTranscode: forceTranscode) else { return nil }
        let item = AVPlayerItem(url: url)
        let key = ObjectIdentifier(item)
        itemIDs[key] = queueItem.id
        itemObservers[key] = item.observe(\.status, options: [.new]) { [weak self] item, _ in
            guard item.status == .failed else { return }
            let failedKey = ObjectIdentifier(item)
            Task { @MainActor in self?.itemFailed(key: failedKey) }
        }
        return item
    }

    private func forget(_ item: AVPlayerItem) {
        let key = ObjectIdentifier(item)
        itemIDs[key] = nil
        itemObservers[key] = nil
    }

    /// Replaces whatever is loaded with the current queue item.
    private func loadCurrent(autoplay: Bool, startAt: Double = 0, forceTranscode: Bool = false) {
        guard let queueItem = currentItem else { return }
        reloading = true
        for item in player.items() { forget(item) }
        player.removeAllItems()
        if !forceTranscode { fallbackFor = nil }
        guard let item = makeItem(for: queueItem, forceTranscode: forceTranscode) else {
            reloading = false
            return
        }
        player.insert(item, after: nil)
        reloading = false
        if startAt > 0 {
            player.seek(to: CMTime(seconds: startAt, preferredTimescale: 600), toleranceBefore: .zero, toleranceAfter: .zero)
        }
        trackStarted(at: startAt)
        syncUpcoming()
        if autoplay {
            activateAudioSession()
            player.play()
        }
        save()
    }

    /// Keeps exactly one "next" item queued behind the current one.
    private func syncUpcoming() {
        let items = player.items()
        guard let first = items.first else { return }
        let nextIndex: Int? = {
            if repeatMode == .one { return nil }
            if index + 1 < queue.count { return index + 1 }
            if repeatMode == .all, queue.count > 1 { return 0 }
            return nil
        }()
        if let nextIndex, items.count == 2, itemIDs[ObjectIdentifier(items[1])] == queue[nextIndex].id {
            return
        }
        for extra in items.dropFirst() {
            forget(extra)
            player.remove(extra)
        }
        if let nextIndex, let next = makeItem(for: queue[nextIndex]) {
            player.insert(next, after: first)
        }
    }

    private func observePlayer() {
        playerObservers.append(player.observe(\.currentItem, options: [.new]) { [weak self] _, _ in
            Task { @MainActor in self?.currentItemChanged() }
        })
        playerObservers.append(player.observe(\.timeControlStatus, options: [.new]) { [weak self] _, _ in
            Task { @MainActor in self?.statusChanged() }
        })
        timeObserver = player.addPeriodicTimeObserver(forInterval: CMTime(seconds: 0.25, preferredTimescale: 600), queue: .main) { [weak self] time in
            MainActor.assumeIsolated { self?.tick(time.seconds) }
        }
    }

    private func currentItemChanged() {
        guard !reloading else { return }
        if let item = player.currentItem, let id = itemIDs[ObjectIdentifier(item)] {
            if let i = queue.firstIndex(where: { $0.id == id }), i != index {
                index = i
                trackStarted(at: 0)
                save()
            }
            syncUpcoming()
        } else if player.currentItem == nil, currentItem != nil {
            // Ran past everything that was queued in the player.
            advance(userInitiated: false)
        }
    }

    private func statusChanged() {
        let status = player.timeControlStatus
        isPlaying = status != .paused
        isBuffering = status == .waitingToPlayAtSpecifiedRate
        if status == .playing {
            errorStreak = 0
            if !nowPlayingSent, settings.scrobble, let song = current, let api = Session.shared.api {
                nowPlayingSent = true
                Task { try? await api.scrobble(song.id, submission: false) }
            }
        }
        updateNowPlayingInfo()
    }

    private func trackStarted(at position: Double) {
        listened = 0
        lastTick = position
        scrobbled = false
        nowPlayingSent = false
        startedAt = Date()
        currentTime = position
        duration = Double(current?.duration ?? 0)
        applyGain()
        loadArtwork()
        updateNowPlayingInfo()
    }

    private func tick(_ t: Double) {
        guard t.isFinite else { return }
        currentTime = t
        if let d = player.currentItem?.duration.seconds, d.isFinite, d > 0 { duration = d }
        let delta = t - lastTick
        if isPlaying, delta > 0, delta < 2 { listened += delta }
        lastTick = t

        if !scrobbled, settings.scrobble, duration > 0, listened >= min(240, duration / 2),
           let song = current, let api = Session.shared.api {
            scrobbled = true
            let time = startedAt
            Task { try? await api.scrobble(song.id, submission: true, time: time) }
        }

        // Fetch Autoplay songs ahead of time so the hand-off stays gapless.
        if settings.autoplay, repeatMode == .off, index == queue.count - 1, duration > 0, duration - t < 30, !autoplayLoading {
            Task { await appendAutoplay() }
        }
        savePosition(force: false)
    }

    /// Moves to the next track after a track ended (`userInitiated == false`) or Next was pressed.
    private func advance(userInitiated: Bool) {
        if !userInitiated, repeatMode == .one {
            loadCurrent(autoplay: true)
            return
        }
        if index + 1 < queue.count {
            // The next item is usually already buffered in the player.
            if userInitiated, player.items().count == 2,
               itemIDs[ObjectIdentifier(player.items()[1])] == queue[index + 1].id {
                player.advanceToNextItem()
                activateAudioSession()
                player.play()
            } else {
                index += 1
                loadCurrent(autoplay: true)
            }
            return
        }
        if repeatMode == .all, !queue.isEmpty {
            index = 0
            loadCurrent(autoplay: true)
            return
        }
        if settings.autoplay {
            Task {
                if await appendAutoplay() {
                    index += 1
                    loadCurrent(autoplay: true)
                } else {
                    stopAtEnd()
                }
            }
            return
        }
        stopAtEnd()
    }

    private func stopAtEnd() {
        player.pause()
        if player.currentItem == nil, currentItem != nil {
            loadCurrent(autoplay: false)
        } else {
            seek(to: 0)
        }
    }

    @discardableResult
    private func appendAutoplay() async -> Bool {
        guard !autoplayLoading, let seed = current, let api = Session.shared.api else { return false }
        autoplayLoading = true
        defer { autoplayLoading = false }
        var songs: [Song] = []
        if let artistID = seed.artistId {
            songs = (try? await api.similarSongs(artistID: artistID, count: 40)) ?? []
        }
        if songs.count < 5 {
            songs += (try? await api.randomSongs(size: 40, genre: songs.isEmpty ? seed.genre : nil)) ?? []
        }
        let known = Set(queue.map(\.song.id))
        let fresh = songs.filter { !known.contains($0.id) }.shuffled().prefix(25)
        guard !fresh.isEmpty else { return false }
        let items = fresh.map { QueueItem(song: $0, autoplay: true) }
        queue.append(contentsOf: items)
        originalQueue?.append(contentsOf: items)
        syncUpcoming()
        save()
        return true
    }

    private func itemFailed(key: ObjectIdentifier) {
        guard let id = itemIDs[key], let i = queue.firstIndex(where: { $0.id == id }) else { return }
        if i != index {
            // A preloaded track failed; it will be retried when it becomes current.
            if let item = player.items().first(where: { ObjectIdentifier($0) == key }) {
                forget(item)
                player.remove(item)
            }
            return
        }
        let song = queue[i].song
        // A codec the device can't decode: retry once as a transcoded stream.
        if fallbackFor != song.id {
            fallbackFor = song.id
            loadCurrent(autoplay: true, forceTranscode: true)
            return
        }
        errorStreak += 1
        lastError = "Couldn't play “\(song.title)”"
        if errorStreak < 3, index + 1 < queue.count {
            index += 1
            loadCurrent(autoplay: true)
        } else {
            player.pause()
        }
    }

    private func applyGain() {
        guard settings.soundCheck, let song = current, let rg = song.replayGain else {
            player.volume = 1
            return
        }
        let neighbour = queue.indices.contains(index + 1) ? queue[index + 1].song : (index > 0 ? queue[index - 1].song : nil)
        let albumMode = neighbour?.albumId == song.albumId && rg.albumGain != nil
        let db = (albumMode ? rg.albumGain : rg.trackGain) ?? rg.trackGain ?? 0
        player.volume = Float(min(1, pow(10, db / 20)))
    }

    // MARK: - System integration

    private func activateAudioSession() {
        let session = AVAudioSession.sharedInstance()
        try? session.setCategory(.playback, mode: .default, policy: .longFormAudio)
        try? session.setActive(true)
    }

    private func observeSystemEvents() {
        let center = NotificationCenter.default
        center.addObserver(forName: AVAudioSession.interruptionNotification, object: nil, queue: .main) { [weak self] note in
            let typeValue = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt
            let optionsValue = note.userInfo?[AVAudioSessionInterruptionOptionKey] as? UInt
            MainActor.assumeIsolated {
                guard let self, let typeValue, let type = AVAudioSession.InterruptionType(rawValue: typeValue) else { return }
                if type == .ended, let optionsValue,
                   AVAudioSession.InterruptionOptions(rawValue: optionsValue).contains(.shouldResume) {
                    self.resume()
                }
            }
        }
        center.addObserver(forName: AVAudioSession.routeChangeNotification, object: nil, queue: .main) { [weak self] note in
            let reasonValue = note.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt
            MainActor.assumeIsolated {
                // Pause when headphones are unplugged, like every other music app.
                if let reasonValue, AVAudioSession.RouteChangeReason(rawValue: reasonValue) == .oldDeviceUnavailable {
                    self?.pause()
                }
            }
        }
        center.addObserver(forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { self?.savePosition(force: true) }
        }
    }

    private func setUpRemoteCommands() {
        let center = MPRemoteCommandCenter.shared()
        center.playCommand.addTarget { [weak self] _ in
            Task { @MainActor in self?.resume() }
            return .success
        }
        center.pauseCommand.addTarget { [weak self] _ in
            Task { @MainActor in self?.pause() }
            return .success
        }
        center.togglePlayPauseCommand.addTarget { [weak self] _ in
            Task { @MainActor in self?.togglePlay() }
            return .success
        }
        center.nextTrackCommand.addTarget { [weak self] _ in
            Task { @MainActor in self?.next() }
            return .success
        }
        center.previousTrackCommand.addTarget { [weak self] _ in
            Task { @MainActor in self?.previous() }
            return .success
        }
        center.changePlaybackPositionCommand.addTarget { [weak self] event in
            guard let event = event as? MPChangePlaybackPositionCommandEvent else { return .commandFailed }
            let position = event.positionTime
            Task { @MainActor in self?.seek(to: position) }
            return .success
        }
    }

    private func loadArtwork() {
        guard let song = current, let api = Session.shared.api else { return }
        guard artworkFor != song.coverArt else { return }
        artworkFor = song.coverArt
        artwork = nil
        guard let url = api.coverURL(song.coverArt, size: 600) else { return }
        let cover = song.coverArt
        Task {
            guard let image = await ImageLoader.shared.image(for: url, maxPixel: 600), self.artworkFor == cover else { return }
            self.artwork = MPMediaItemArtwork(boundsSize: image.size) { _ in image }
            self.updateNowPlayingInfo()
        }
    }

    private func updateNowPlayingInfo() {
        guard let song = current else {
            MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
            return
        }
        var info: [String: Any] = [
            MPMediaItemPropertyTitle: song.title,
            MPMediaItemPropertyArtist: song.artistName,
            MPMediaItemPropertyAlbumTitle: song.album ?? "",
            MPMediaItemPropertyPlaybackDuration: duration,
            MPNowPlayingInfoPropertyElapsedPlaybackTime: currentTime,
            MPNowPlayingInfoPropertyPlaybackRate: isPlaying ? 1.0 : 0.0,
        ]
        if let artwork { info[MPMediaItemPropertyArtwork] = artwork }
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
    }

    // MARK: - Persistence

    private static let positionKey = "player.position"

    private struct Saved: Codable {
        var queue: [QueueItem]
        var originalQueue: [QueueItem]?
        var index: Int
        var shuffle: Bool
        var repeatMode: RepeatMode
        var sourceName: String?
    }

    private static var saveURL: URL {
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir.appendingPathComponent("player.json")
    }

    private func save() {
        let start = max(0, index - 200)
        let window = Array(queue.dropFirst(start).prefix(1500))
        let saved = Saved(
            queue: window,
            originalQueue: originalQueue.map { Array($0.prefix(1500)) },
            index: index - start,
            shuffle: shuffle,
            repeatMode: repeatMode,
            sourceName: sourceName
        )
        if let data = try? JSONEncoder().encode(saved) {
            try? data.write(to: Self.saveURL, options: .atomic)
        }
    }

    private func savePosition(force: Bool) {
        guard force || Date().timeIntervalSince(lastPositionSave) > 5 else { return }
        lastPositionSave = Date()
        UserDefaults.standard.set(currentTime, forKey: Self.positionKey)
    }

    private func restore() {
        guard let data = try? Data(contentsOf: Self.saveURL),
              let saved = try? JSONDecoder().decode(Saved.self, from: data),
              saved.queue.indices.contains(saved.index) else { return }
        queue = saved.queue
        originalQueue = saved.originalQueue
        index = saved.index
        shuffle = saved.shuffle
        repeatMode = saved.repeatMode
        sourceName = saved.sourceName
        currentTime = UserDefaults.standard.double(forKey: Self.positionKey)
        duration = Double(current?.duration ?? 0)
    }

    /// Called once the session is known to be valid: preload the restored track (paused).
    func prepareRestoredTrack() {
        guard player.currentItem == nil, currentItem != nil, Session.shared.api != nil else { return }
        loadCurrent(autoplay: false, startAt: UserDefaults.standard.double(forKey: Self.positionKey))
    }

    /// Stops playback and forgets the queue (used on sign-out).
    func reset() {
        player.pause()
        for item in player.items() { forget(item) }
        player.removeAllItems()
        queue = []
        originalQueue = nil
        index = -1
        currentTime = 0
        duration = 0
        sourceName = nil
        save()
        updateNowPlayingInfo()
    }
}
