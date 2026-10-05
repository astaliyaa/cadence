import SwiftUI

@main
struct CadenceApp: App {
    @State private var session = Session.shared
    @State private var player = PlayerModel.shared
    @State private var settings = AppSettings.shared
    @State private var favorites = Favorites.shared
    @State private var toast = Toast.shared
    @State private var router = Router.shared

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(session)
                .environment(player)
                .environment(settings)
                .environment(favorites)
                .environment(toast)
                .environment(router)
        }
    }
}

struct RootView: View {
    @Environment(Session.self) private var session

    var body: some View {
        Group {
            if session.isSignedIn {
                MainTabView()
                    .task {
                        await session.refreshServerInfo()
                        PlayerModel.shared.prepareRestoredTrack()
                    }
            } else {
                LoginView()
            }
        }
        .animation(.default, value: session.isSignedIn)
    }
}

struct MainTabView: View {
    @Environment(Router.self) private var router
    @Environment(PlayerModel.self) private var player

    /// iOS 26 has a dedicated slot above the tab bar for a mini player.
    private var usesBottomAccessory: Bool {
        #if compiler(>=6.2)
        if #available(iOS 26.0, *) { return true }
        #endif
        return false
    }

    var body: some View {
        @Bindable var router = router
        TabView(selection: $router.tab) {
            Tab("Home", systemImage: "house.fill", value: AppTab.home) {
                NavigationStack(path: $router.homePath) {
                    HomeView().withRoutes()
                }
                .modifier(LegacyMiniPlayerInset(enabled: !usesBottomAccessory))
            }
            Tab("Library", systemImage: "square.stack.fill", value: AppTab.library) {
                NavigationStack(path: $router.libraryPath) {
                    LibraryView().withRoutes()
                }
                .modifier(LegacyMiniPlayerInset(enabled: !usesBottomAccessory))
            }
            Tab("Search", systemImage: "magnifyingglass", value: AppTab.search, role: .search) {
                NavigationStack(path: $router.searchPath) {
                    SearchView().withRoutes()
                }
                .modifier(LegacyMiniPlayerInset(enabled: !usesBottomAccessory))
            }
        }
        .modifier(BottomAccessory())
        .fullScreenCover(isPresented: $router.showNowPlaying) {
            NowPlayingView()
        }
        .sheet(item: $router.addToPlaylist) { batch in
            AddToPlaylistSheet(batch: batch)
        }
        .overlay(alignment: .bottom) {
            ToastView()
                .padding(.bottom, 150)
                .animation(.spring(duration: 0.35), value: Toast.shared.message)
        }
    }
}

/// iOS 26+: the mini player lives in the tab bar's bottom accessory.
private struct BottomAccessory: ViewModifier {
    func body(content: Content) -> some View {
        #if compiler(>=6.2)
        if #available(iOS 26.0, *) {
            content
                .tabViewBottomAccessory { MiniPlayer(style: .accessory) }
                .tabBarMinimizeBehavior(.onScrollDown)
        } else {
            content
        }
        #else
        content
        #endif
    }
}

/// iOS 18: a floating mini player above the tab bar.
private struct LegacyMiniPlayerInset: ViewModifier {
    var enabled: Bool
    @Environment(PlayerModel.self) private var player

    func body(content: Content) -> some View {
        content.safeAreaInset(edge: .bottom, spacing: 0) {
            if enabled, player.current != nil {
                MiniPlayer(style: .floating)
                    .padding(.horizontal, 8)
                    .padding(.bottom, 6)
            }
        }
    }
}

struct MiniPlayer: View {
    enum Style { case floating, accessory }
    var style: Style

    @Environment(PlayerModel.self) private var player
    @Environment(Router.self) private var router

    var body: some View {
        let song = player.current
        HStack(spacing: 12) {
            ArtworkView(id: song?.coverArt, size: style == .floating ? 44 : 32, cornerRadius: style == .floating ? 6 : 5)
            VStack(alignment: .leading, spacing: 1) {
                Text(song?.title ?? "Not Playing")
                    .font(.subheadline.weight(.medium))
                    .lineLimit(1)
                if style == .floating, let song {
                    Text(song.artistName)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            }
            Spacer(minLength: 4)
            Button {
                player.togglePlay()
            } label: {
                Image(systemName: player.isPlaying ? "pause.fill" : "play.fill")
                    .font(.title3)
                    .contentTransition(.symbolEffect(.replace))
                    .frame(width: 36, height: 36)
            }
            .disabled(song == nil)
            Button {
                player.next()
            } label: {
                Image(systemName: "forward.fill")
                    .font(.title3)
                    .frame(width: 36, height: 36)
            }
            .disabled(song == nil)
        }
        .buttonStyle(.plain)
        .padding(.leading, style == .floating ? 8 : 14)
        .padding(.trailing, style == .floating ? 8 : 10)
        .padding(.vertical, style == .floating ? 8 : 0)
        .background {
            if style == .floating {
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .fill(.regularMaterial)
                    .shadow(color: .black.opacity(0.15), radius: 12, y: 4)
            }
        }
        .contentShape(Rectangle())
        .onTapGesture {
            if song != nil { router.showNowPlaying = true }
        }
    }
}
