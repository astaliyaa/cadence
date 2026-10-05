import Foundation
import Observation
import UIKit

struct DownloadedSong: Codable, Hashable {
    var song: Song
    var file: String
    var bytes: Int64
    var date: Date
}

enum DownloadState: Equatable {
    case none
    case downloading(Double?)
    case downloaded
}

enum DownloadQuality: String, CaseIterable, Identifiable {
    case original, high, medium
    var id: String { rawValue }

    var title: String {
        switch self {
        case .original: "Original"
        case .high: "High (320 kbps)"
        case .medium: "Space Saver (192 kbps)"
        }
    }

    var params: (String?, Int?) {
        switch self {
        case .original: ("raw", nil)
        case .high: ("mp3", 320)
        case .medium: ("mp3", 192)
        }
    }
}

/// Offline downloads. Uses a background URLSession, so downloads keep going while
/// the app is suspended or closed. Files live in Application Support (excluded from
/// iCloud backups); an index keeps each song's metadata for offline browsing.
@Observable
@MainActor
final class DownloadManager {
    static let shared = DownloadManager()

    private(set) var downloaded: [String: DownloadedSong] = [:]
    /// In-flight downloads: song id → progress (nil while unknown).
    private(set) var active: [String: Double?] = [:]
    private(set) var failed = 0
    private(set) var preparingLibrary = false

    @ObservationIgnored private var pending: [String: Song] = [:]
    @ObservationIgnored private var session: URLSession!
    private let delegate = DownloadSessionDelegate()
    @ObservationIgnored private var saveTask: Task<Void, Never>?
    @ObservationIgnored private var coversInFlight = Set<String>()

    nonisolated static let sessionID = "cadence.downloads"
    private static let unsupportedSuffixes: Set<String> = ["ogg", "oga", "opus", "wma", "ape", "wv", "dsf", "dff", "mpc", "webm"]

    // MARK: locations

    nonisolated static var root: URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        var dir = base.appendingPathComponent("Downloads", isDirectory: true)
        if !FileManager.default.fileExists(atPath: dir.path) {
            try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            var values = URLResourceValues()
            values.isExcludedFromBackup = true
            try? dir.setResourceValues(values)
        }
        return dir
    }

    nonisolated static var songsDirectory: URL { subdirectory("Songs") }
    nonisolated static var coversDirectory: URL { subdirectory("Covers") }

    private nonisolated static func subdirectory(_ name: String) -> URL {
        let dir = root.appendingPathComponent(name, isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    nonisolated static func coverFile(_ coverID: String) -> URL {
        coversDirectory.appendingPathComponent(safeName(coverID) + ".jpg")
    }

    nonisolated static func safeName(_ id: String) -> String {
        String(id.map { $0.isLetter || $0.isNumber || $0 == "-" || $0 == "_" ? $0 : "_" })
    }

    // MARK: lifecycle

    private init() {
        downloaded = Self.load([String: DownloadedSong].self, "index.json") ?? [:]
        pending = Self.load([String: Song].self, "pending.json") ?? [:]
        // Drop index entries whose files went missing.
        let fm = FileManager.default
        downloaded = downloaded.filter { fm.fileExists(atPath: Self.songsDirectory.appendingPathComponent($0.value.file).path) }

        let config = URLSessionConfiguration.background(withIdentifier: Self.sessionID)
        config.isDiscretionary = false
        config.sessionSendsLaunchEvents = true
        config.httpMaximumConnectionsPerHost = 4
        config.timeoutIntervalForResource = 60 * 60 * 6
        session = URLSession(configuration: config, delegate: delegate, delegateQueue: nil)

        // Re-attach to downloads that were running when the app was closed.
        for id in pending.keys { active[id] = .some(nil) }
        session.getAllTasks { tasks in
            let running = Set(tasks.compactMap { $0.taskDescription.map(DownloadSessionDelegate.songID(from:)) })
            Task { @MainActor in DownloadManager.shared.reconcile(running: running) }
        }
    }

    private func reconcile(running: Set<String>) {
        // Anything pending without a live task (e.g. the app was force-quit) is restarted.
        let lost = pending.values.filter { !running.contains($0.id) && downloaded[$0.id] == nil }
        for song in lost {
            pending[song.id] = nil
            active[song.id] = nil
        }
        if !lost.isEmpty { download(Array(lost)) }
    }

    // MARK: queries

    func state(of songID: String) -> DownloadState {
        if downloaded[songID] != nil { return .downloaded }
        if let progress = active[songID] { return .downloading(progress) }
        return .none
    }

    /// Local file for a downloaded song, if any.
    func localURL(for songID: String) -> URL? {
        guard let entry = downloaded[songID] else { return nil }
        return Self.songsDirectory.appendingPathComponent(entry.file)
    }

    func state(of songs: [Song]) -> DownloadState {
        guard !songs.isEmpty else { return .none }
        if songs.allSatisfy({ downloaded[$0.id] != nil }) { return .downloaded }
        if songs.contains(where: { active[$0.id] != nil }) {
            let done = songs.filter { downloaded[$0.id] != nil }.count
            return .downloading(Double(done) / Double(songs.count))
        }
        return .none
    }

    var totalBytes: Int64 { downloaded.values.reduce(0) { $0 + $1.bytes } }

    /// Overall progress of the current batch (finished / (finished + remaining)).
    var batchProgress: Double {
        let remaining = Double(active.count)
        let finished = Double(batchFinished)
        return finished + remaining > 0 ? finished / (finished + remaining) : 0
    }

    private(set) var batchFinished = 0

    // MARK: actions

    func download(_ songs: [Song]) {
        guard let api = Session.shared.api else { return }
        let settings = AppSettings.shared
        var started = 0
        for song in songs where downloaded[song.id] == nil && active[song.id] == nil {
            var (format, bitrate) = settings.downloadQuality.params
            if format == "raw", Self.unsupportedSuffixes.contains((song.suffix ?? "").lowercased()) {
                format = "mp3"
                bitrate = 320
            }
            var request = URLRequest(url: api.streamURL(songID: song.id, format: format, maxBitRate: bitrate))
            request.allowsCellularAccess = settings.downloadOverCellular
            let task = session.downloadTask(with: request)
            task.taskDescription = "\(song.id)|\((format == "raw" ? song.suffix : format) ?? "mp3")"
            pending[song.id] = song
            active[song.id] = .some(nil)
            task.resume()
            started += 1
            if let cover = song.coverArt { saveCover(cover) }
        }
        if started > 0 {
            if active.count == started { batchFinished = 0 }
            scheduleSave()
        }
    }

    func remove(_ songs: [Song]) {
        let ids = Set(songs.map(\.id))
        cancel(ids)
        for id in ids {
            if let entry = downloaded.removeValue(forKey: id) {
                try? FileManager.default.removeItem(at: Self.songsDirectory.appendingPathComponent(entry.file))
            }
        }
        scheduleSave()
    }

    func removeAll() {
        cancelAll()
        try? FileManager.default.removeItem(at: Self.songsDirectory)
        try? FileManager.default.removeItem(at: Self.coversDirectory)
        downloaded = [:]
        scheduleSave()
    }

    func cancelAll() {
        cancel(Set(active.keys))
    }

    /// Stops in-flight downloads for these songs (already-downloaded ones stay).
    func cancelDownloads(_ songs: [Song]) {
        cancel(Set(songs.map(\.id).filter { active[$0] != nil }))
    }

    private func cancel(_ ids: Set<String>) {
        guard !ids.isEmpty else { return }
        session.getAllTasks { tasks in
            for task in tasks where ids.contains(DownloadSessionDelegate.songID(from: task.taskDescription ?? "")) {
                task.cancel()
            }
        }
        for id in ids {
            active[id] = nil
            pending[id] = nil
        }
        scheduleSave()
    }

    /// Every song in the library (paged through search3).
    func allLibrarySongs() async throws -> [Song] {
        guard let api = Session.shared.api else { return [] }
        var all: [Song] = []
        var offset = 0
        while true {
            let page = try await api.search("", artists: 0, albums: 0, songs: 500, songOffset: offset).song ?? []
            all += page
            if page.count < 500 { break }
            offset += 500
        }
        return all
    }

    struct LibraryEstimate {
        var songs: [Song]
        var bytes: Int64
        var freeBytes: Int64?
    }

    func estimateLibrary() async throws -> LibraryEstimate {
        preparingLibrary = true
        defer { preparingLibrary = false }
        let missing = try await allLibrarySongs().filter { downloaded[$0.id] == nil }
        let quality = AppSettings.shared.downloadQuality
        let bytes = missing.reduce(Int64(0)) { sum, song in
            if quality == .original, let size = song.size { return sum + size }
            let kbps = quality.params.1 ?? 320
            return sum + Int64(song.duration ?? 240) * Int64(kbps) * 125
        }
        let free = try? URL(fileURLWithPath: NSHomeDirectory())
            .resourceValues(forKeys: [.volumeAvailableCapacityForImportantUsageKey])
            .volumeAvailableCapacityForImportantUsage
        return LibraryEstimate(songs: missing, bytes: bytes, freeBytes: free)
    }

    // MARK: delegate callbacks

    func progress(_ songID: String, _ value: Double) {
        guard active[songID] != nil else { return }
        let old = (active[songID] ?? nil) ?? -1
        if value >= 1 || value - old >= 0.04 { active[songID] = .some(value) }
    }

    func finished(_ songID: String, file: String, bytes: Int64) {
        let song = pending.removeValue(forKey: songID)
        active[songID] = nil
        guard let song else {
            try? FileManager.default.removeItem(at: Self.songsDirectory.appendingPathComponent(file))
            return
        }
        downloaded[songID] = DownloadedSong(song: song, file: file, bytes: bytes, date: Date())
        batchFinished += 1
        scheduleSave()
    }

    func failedDownload(_ songID: String) {
        guard pending[songID] != nil else { return }
        pending[songID] = nil
        active[songID] = nil
        failed += 1
        scheduleSave()
    }

    // MARK: covers

    private func saveCover(_ coverID: String) {
        let file = Self.coverFile(coverID)
        guard !coversInFlight.contains(coverID), !FileManager.default.fileExists(atPath: file.path),
              let url = Session.shared.api?.coverURL(coverID, size: 600) else { return }
        coversInFlight.insert(coverID)
        Task.detached {
            if let result = try? await URLSession.shared.data(from: url), !result.0.isEmpty,
               (result.1 as? HTTPURLResponse)?.statusCode == 200 {
                try? result.0.write(to: file, options: .atomic)
            }
            await MainActor.run { _ = DownloadManager.shared.coversInFlight.remove(coverID) }
        }
    }

    // MARK: persistence

    private func scheduleSave() {
        saveTask?.cancel()
        saveTask = Task {
            try? await Task.sleep(for: .seconds(1))
            guard !Task.isCancelled else { return }
            Self.store(downloaded, "index.json")
            Self.store(pending, "pending.json")
        }
    }

    private static func load<T: Decodable>(_ type: T.Type, _ name: String) -> T? {
        guard let data = try? Data(contentsOf: root.appendingPathComponent(name)) else { return nil }
        return try? JSONDecoder().decode(type, from: data)
    }

    private static func store<T: Encodable>(_ value: T, _ name: String) {
        guard let data = try? JSONEncoder().encode(value) else { return }
        try? data.write(to: root.appendingPathComponent(name), options: .atomic)
    }

    // MARK: file types

    nonisolated static func fileExtension(mimeType: String?, fallback: String) -> String {
        switch (mimeType ?? "").lowercased() {
        case "audio/flac", "audio/x-flac": "flac"
        case "audio/mpeg", "audio/mp3", "audio/mpeg3": "mp3"
        case "audio/mp4", "audio/x-m4a", "audio/m4a", "audio/aac", "audio/x-aac", "audio/aacp": "m4a"
        case "audio/wav", "audio/x-wav", "audio/wave": "wav"
        case "audio/aiff", "audio/x-aiff": "aiff"
        default: fallback.isEmpty ? "mp3" : fallback.lowercased()
        }
    }
}

/// URLSession delegate for the background download session (runs off the main thread).
final class DownloadSessionDelegate: NSObject, URLSessionDownloadDelegate, @unchecked Sendable {
    /// taskDescription is "songID|suffix".
    static func songID(from description: String) -> String {
        String(description.split(separator: "|", maxSplits: 1).first ?? "")
    }

    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didFinishDownloadingTo location: URL) {
        let description = downloadTask.taskDescription ?? ""
        let songID = Self.songID(from: description)
        let suffix = description.split(separator: "|", maxSplits: 1).dropFirst().first.map(String.init) ?? "mp3"
        guard !songID.isEmpty else { return }
        guard let http = downloadTask.response as? HTTPURLResponse, (200..<300).contains(http.statusCode),
              !(http.mimeType ?? "").hasPrefix("application/json"), !(http.mimeType ?? "").hasPrefix("text/") else {
            Task { @MainActor in DownloadManager.shared.failedDownload(songID) }
            return
        }
        // The temporary file disappears when this method returns, so move it now.
        let ext = DownloadManager.fileExtension(mimeType: http.mimeType, fallback: suffix)
        let name = "\(DownloadManager.safeName(songID)).\(ext)"
        let destination = DownloadManager.songsDirectory.appendingPathComponent(name)
        do {
            try? FileManager.default.removeItem(at: destination)
            try FileManager.default.moveItem(at: location, to: destination)
        } catch {
            Task { @MainActor in DownloadManager.shared.failedDownload(songID) }
            return
        }
        let size = Int64((try? destination.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0)
        Task { @MainActor in DownloadManager.shared.finished(songID, file: name, bytes: size) }
    }

    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didWriteData bytesWritten: Int64,
                    totalBytesWritten: Int64, totalBytesExpectedToWrite: Int64) {
        guard totalBytesExpectedToWrite > 0 else { return }
        let songID = Self.songID(from: downloadTask.taskDescription ?? "")
        let value = Double(totalBytesWritten) / Double(totalBytesExpectedToWrite)
        Task { @MainActor in DownloadManager.shared.progress(songID, value) }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        guard let error, (error as NSError).code != NSURLErrorCancelled else { return }
        let songID = Self.songID(from: task.taskDescription ?? "")
        Task { @MainActor in DownloadManager.shared.failedDownload(songID) }
    }

    func urlSessionDidFinishEvents(forBackgroundURLSession session: URLSession) {
        Task { @MainActor in
            AppDelegate.backgroundCompletion?()
            AppDelegate.backgroundCompletion = nil
        }
    }
}

/// Lets iOS wake the app to finish background downloads.
final class AppDelegate: NSObject, UIApplicationDelegate {
    @MainActor static var backgroundCompletion: (() -> Void)?

    func application(_ application: UIApplication, handleEventsForBackgroundURLSession identifier: String,
                     completionHandler: @escaping () -> Void) {
        guard identifier == DownloadManager.sessionID else { return completionHandler() }
        AppDelegate.backgroundCompletion = completionHandler
        _ = DownloadManager.shared
    }
}
