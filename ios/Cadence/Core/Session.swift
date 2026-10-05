import Foundation
import Observation

/// The signed-in Navidrome connection.
@Observable
@MainActor
final class Session {
    static let shared = Session()

    private(set) var api: SubsonicClient?
    private(set) var serverType: String?
    private(set) var serverVersion: String?
    private(set) var extensions: [String] = []

    private static let credsKey = "credentials"

    private init() {
        if let data = Keychain.get(Self.credsKey),
           let creds = try? JSONDecoder().decode(Credentials.self, from: data) {
            api = SubsonicClient(creds: creds)
        }
    }

    var isSignedIn: Bool { api != nil }
    var supportsSyncedLyrics: Bool { extensions.contains("songLyrics") }

    func signIn(client: SubsonicClient, info: SubsonicResponse) {
        if let data = try? JSONEncoder().encode(client.creds) {
            Keychain.set(data, for: Self.credsKey)
        }
        UserDefaults.standard.set(client.creds.server.absoluteString, forKey: "lastServer")
        UserDefaults.standard.set(client.creds.username, forKey: "lastUser")
        api = client
        serverType = info.type
        serverVersion = info.serverVersion
        Task { await refreshServerInfo() }
    }

    func signOut() {
        Keychain.delete(Self.credsKey)
        api = nil
        serverType = nil
        serverVersion = nil
        extensions = []
        DataCache.shared.clear()
    }

    /// Re-checks the stored credentials and loads server capabilities.
    func refreshServerInfo() async {
        guard let api else { return }
        do {
            let info = try await api.get("ping")
            serverType = info.type
            serverVersion = info.serverVersion
        } catch let error as SubsonicError where error.code == 40 || error.code == 41 {
            signOut()
            return
        } catch {}
        extensions = await api.extensions()
    }
}

/// Small in-memory cache so navigating back and forth doesn't refetch everything.
@MainActor
final class DataCache {
    static let shared = DataCache()
    private var store: [String: (value: Any, time: Date)] = [:]
    private let ttl: TimeInterval = 5 * 60

    func value<T>(_ key: String, as _: T.Type = T.self) -> T? {
        guard let hit = store[key], Date().timeIntervalSince(hit.time) < ttl else { return nil }
        return hit.value as? T
    }

    func set(_ key: String, _ value: Any) {
        store[key] = (value, Date())
    }

    func invalidate(prefix: String) {
        store = store.filter { !$0.key.hasPrefix(prefix) }
    }

    func clear() { store = [:] }

    /// Returns a cached value or loads (and caches) it.
    func load<T>(_ key: String, _ loader: () async throws -> T) async throws -> T {
        if let hit: T = value(key) { return hit }
        let fresh = try await loader()
        set(key, fresh)
        return fresh
    }
}
