import Observation
import SwiftUI

enum AppTab: Hashable {
    case home, library, search
}

enum Route: Hashable {
    case album(String)
    case artist(String)
    case playlist(String)
    case genre(String)
    case albumList(AlbumListType)
    case allAlbums
    case artists
    case songs
    case playlists
    case genres
    case favorites
}

struct SongBatch: Identifiable {
    let id = UUID()
    let songs: [Song]
}

/// Navigation state for each tab, so menus and the player can push screens.
@Observable
@MainActor
final class Router {
    static let shared = Router()

    var tab: AppTab = .home
    var homePath: [Route] = []
    var libraryPath: [Route] = []
    var searchPath: [Route] = []
    var addToPlaylist: SongBatch?
    var showNowPlaying = false

    func go(_ route: Route) {
        // Coming from the full-screen player: close it first, then navigate.
        if showNowPlaying {
            showNowPlaying = false
            Task {
                try? await Task.sleep(for: .milliseconds(350))
                push(route)
            }
        } else {
            push(route)
        }
    }

    private func push(_ route: Route) {
        switch tab {
        case .home: homePath.append(route)
        case .library: libraryPath.append(route)
        case .search: searchPath.append(route)
        }
    }
}

struct RouteView: View {
    let route: Route

    var body: some View {
        switch route {
        case .album(let id): AlbumView(id: id)
        case .artist(let id): ArtistView(id: id)
        case .playlist(let id): PlaylistView(id: id)
        case .genre(let name): GenreView(genre: name)
        case .albumList(let type): AlbumGridView(type: type, title: type.title)
        case .allAlbums: AlbumGridView(type: .alphabeticalByName, title: "Albums", sortable: true)
        case .artists: ArtistsListView()
        case .songs: SongsListView()
        case .playlists: PlaylistsListView()
        case .genres: GenresView()
        case .favorites: FavoritesView()
        }
    }
}

extension View {
    func withRoutes() -> some View {
        navigationDestination(for: Route.self) { RouteView(route: $0) }
    }
}
