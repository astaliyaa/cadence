import Foundation
import Observation

enum StreamQuality: String, CaseIterable, Identifiable {
    case original, high, medium, low
    var id: String { rawValue }

    var title: String {
        switch self {
        case .original: "Original"
        case .high: "High (320 kbps)"
        case .medium: "Medium (192 kbps)"
        case .low: "Data Saver (128 kbps)"
        }
    }

    /// (format, maxBitRate) for Navidrome's stream endpoint.
    var params: (String?, Int?) {
        switch self {
        case .original: ("raw", nil)
        case .high: ("mp3", 320)
        case .medium: ("mp3", 192)
        case .low: ("mp3", 128)
        }
    }
}

enum ArtworkQuality: String, CaseIterable, Identifiable {
    case standard, high, original
    var id: String { rawValue }
    var title: String { rawValue.capitalized }
}

/// User preferences, persisted in UserDefaults.
@Observable
@MainActor
final class AppSettings {
    static let shared = AppSettings()
    private let defaults = UserDefaults.standard

    var wifiQuality: StreamQuality { didSet { defaults.set(wifiQuality.rawValue, forKey: "wifiQuality") } }
    var cellularQuality: StreamQuality { didSet { defaults.set(cellularQuality.rawValue, forKey: "cellularQuality") } }
    var soundCheck: Bool { didSet { defaults.set(soundCheck, forKey: "soundCheck") } }
    var autoplay: Bool { didSet { defaults.set(autoplay, forKey: "autoplay") } }
    var scrobble: Bool { didSet { defaults.set(scrobble, forKey: "scrobble") } }
    var lrclib: Bool { didSet { defaults.set(lrclib, forKey: "lrclib") } }
    var artworkQuality: ArtworkQuality { didSet { defaults.set(artworkQuality.rawValue, forKey: "artworkQuality") } }
    var motionEnabled: Bool { didSet { defaults.set(motionEnabled, forKey: "motionEnabled") } }
    var motionAutoToken: Bool { didSet { defaults.set(motionAutoToken, forKey: "motionAutoToken") } }
    var motionToken: String { didSet { defaults.set(motionToken, forKey: "motionToken") } }
    var storefront: String { didSet { defaults.set(storefront, forKey: "storefront") } }
    var downloadQuality: DownloadQuality { didSet { defaults.set(downloadQuality.rawValue, forKey: "downloadQuality") } }
    var downloadOverCellular: Bool { didSet { defaults.set(downloadOverCellular, forKey: "downloadOverCellular") } }

    private init() {
        let d = UserDefaults.standard
        func bool(_ key: String, _ fallback: Bool) -> Bool {
            d.object(forKey: key) == nil ? fallback : d.bool(forKey: key)
        }
        wifiQuality = StreamQuality(rawValue: d.string(forKey: "wifiQuality") ?? "") ?? .original
        cellularQuality = StreamQuality(rawValue: d.string(forKey: "cellularQuality") ?? "") ?? .high
        soundCheck = bool("soundCheck", false)
        autoplay = bool("autoplay", true)
        scrobble = bool("scrobble", true)
        lrclib = bool("lrclib", true)
        artworkQuality = ArtworkQuality(rawValue: d.string(forKey: "artworkQuality") ?? "") ?? .high
        motionEnabled = bool("motionEnabled", false)
        motionAutoToken = bool("motionAutoToken", true)
        motionToken = d.string(forKey: "motionToken") ?? ""
        storefront = d.string(forKey: "storefront") ?? "us"
        downloadQuality = DownloadQuality(rawValue: d.string(forKey: "downloadQuality") ?? "") ?? .original
        downloadOverCellular = bool("downloadOverCellular", false)
    }
}
