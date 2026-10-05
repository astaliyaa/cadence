import { useEffect, useRef, useState } from "react";
import { HashRouter, Navigate, Route, Routes, useLocation, useNavigate, useNavigationType } from "react-router-dom";
import { useAuth } from "./store/auth";
import { useSettings } from "./store/settings";
import { useUI } from "./store/ui";
import { usePlayer, initPlayer } from "./player/store";
import { engine } from "./player/engine";
import { SubsonicError } from "./api/subsonic";
import { setNavigate } from "./lib/nav";
import { ScrollContext } from "./lib/scroll";
import { invokeQuiet, isMac, isWindows, platformInfo } from "./lib/platform";
import { Sidebar } from "./components/Sidebar";
import { TopBar } from "./components/TopBar";
import { SidePanel } from "./components/SidePanel";
import { NowPlaying } from "./components/NowPlaying";
import { ContextMenuHost, Dialogs, Toasts } from "./components/Overlays";
import { Login } from "./pages/Login";
import { Home } from "./pages/Home";
import { AlbumPage } from "./pages/AlbumPage";
import { ArtistPage } from "./pages/ArtistPage";
import { PlaylistPage } from "./pages/PlaylistPage";
import { AlbumListPage, AlbumsPage, ArtistsPage, FavoritesPage, GenrePage, GenresPage, SongsPage } from "./pages/Library";
import { SearchPage } from "./pages/SearchPage";
import { SettingsPage } from "./pages/SettingsPage";

function useAppearance() {
  const theme = useSettings((s) => s.theme);
  const accent = useSettings((s) => s.accent);
  const [systemDark, setSystemDark] = useState(() => matchMedia("(prefers-color-scheme: dark)").matches);

  useEffect(() => {
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const on = () => setSystemDark(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);

  const dark = theme === "dark" || (theme === "system" && systemDark);

  useEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
  }, [dark]);

  useEffect(() => {
    invokeQuiet("set_window_theme", { dark: theme === "system" ? null : theme === "dark" });
  }, [theme]);

  useEffect(() => {
    document.documentElement.style.setProperty("--accent", accent);
  }, [accent]);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("platform-mac", isMac);
    root.classList.toggle("platform-win", isWindows);
    platformInfo().then((info) => {
      root.classList.toggle("vibrancy", info.vibrancy);
      useUI.getState().setVibrancy(info.vibrancy);
    });
  }, []);
}

function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      const typing = t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable;
      const mod = e.ctrlKey || e.metaKey;
      const p = usePlayer.getState();
      const ui = useUI.getState();
      if (mod && e.key.toLowerCase() === "f" && e.shiftKey) {
        e.preventDefault();
        ui.setNowPlaying(!ui.nowPlayingOpen);
      } else if (mod && e.key.toLowerCase() === "f") {
        e.preventDefault();
        ui.setNowPlaying(false);
        window.dispatchEvent(new Event("cadence:focus-search"));
      } else if (typing) {
        return;
      } else if (e.key === " " && !mod) {
        e.preventDefault();
        // Don't let Space also "click" whichever button has focus.
        if (t.tagName === "BUTTON" || t.tagName === "A") t.blur();
        p.togglePlay();
      } else if (mod && e.key === "ArrowRight") {
        e.preventDefault();
        p.next();
      } else if (mod && e.key === "ArrowLeft") {
        e.preventDefault();
        p.previous();
      } else if (mod && e.key === "ArrowUp") {
        e.preventDefault();
        p.setVolume(p.volume + 0.05);
      } else if (mod && e.key === "ArrowDown") {
        e.preventDefault();
        p.setVolume(p.volume - 0.05);
      } else if (mod && e.key.toLowerCase() === "l") {
        e.preventDefault();
        ui.togglePanel("lyrics");
      } else if (mod && e.key.toLowerCase() === "u") {
        e.preventDefault();
        ui.togglePanel("queue");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

function useSession() {
  useEffect(() => {
    const auth = useAuth.getState();
    const client = auth.client;
    if (!client) return;
    client
      .get<{ type?: string; serverVersion?: string }>("ping")
      .then((info) => useAuth.setState({ serverInfo: { type: info.type, version: info.serverVersion } }))
      .catch((e) => {
        if (e instanceof SubsonicError && (e.code === 40 || e.code === 41)) {
          engine.stop();
          useAuth.getState().signOut();
          useUI.getState().toast("Please sign in again");
        }
      });
    // The player restores the last position, which for transcoded streams needs
    // to know whether the server can start a stream partway in.
    client.extensions().then((ext) => {
      useAuth.getState().setExtensions(ext);
      initPlayer();
    });
  }, []);
}

function Shell() {
  const navigate = useNavigate();
  const location = useLocation();
  const navType = useNavigationType();
  const [scrollEl, setScrollEl] = useState<HTMLElement | null>(null);
  const positions = useRef(new Map<string, number>());

  useEffect(() => setNavigate(navigate), [navigate]);
  useSession();
  useShortcuts();

  // Remember scroll offsets so Back returns to where you were.
  useEffect(() => {
    if (!scrollEl) return;
    const key = location.key;
    const saved = positions.current.get(key);
    requestAnimationFrame(() => {
      scrollEl.scrollTop = navType === "POP" && saved !== undefined ? saved : 0;
    });
    const onScroll = () => positions.current.set(key, scrollEl.scrollTop);
    scrollEl.addEventListener("scroll", onScroll, { passive: true });
    return () => scrollEl.removeEventListener("scroll", onScroll);
  }, [location.key, scrollEl, navType]);

  const splitView = location.pathname.startsWith("/library/artists");

  return (
    <div className="app">
      <Sidebar />
      <div className="main">
        <TopBar />
        <div className="main-body">
          <main ref={setScrollEl} className={`content${splitView ? " no-scroll" : ""}`}>
            <ScrollContext.Provider value={scrollEl}>
              {scrollEl && (
                <Routes>
                  <Route path="/" element={<Home />} />
                  <Route path="/search" element={<SearchPage />} />
                  <Route path="/library/recent" element={<AlbumListPage type="newest" />} />
                  <Route path="/library/albums" element={<AlbumsPage />} />
                  <Route path="/library/artists/:id?" element={<ArtistsPage />} />
                  <Route path="/library/songs" element={<SongsPage />} />
                  <Route path="/library/genres" element={<GenresPage />} />
                  <Route path="/library/favorites" element={<FavoritesPage />} />
                  <Route path="/albums/:type" element={<AlbumListPage />} />
                  <Route path="/album/:id" element={<AlbumPage />} />
                  <Route path="/artist/:id" element={<ArtistPage />} />
                  <Route path="/playlist/:id" element={<PlaylistPage />} />
                  <Route path="/genre/:name" element={<GenrePage />} />
                  <Route path="/settings" element={<SettingsPage />} />
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
              )}
            </ScrollContext.Provider>
          </main>
          <SidePanel />
        </div>
      </div>
      <NowPlaying />
    </div>
  );
}

export function App() {
  const signedIn = useAuth((s) => !!s.client);
  useAppearance();
  return (
    <>
      {signedIn ? (
        <HashRouter>
          <Shell />
        </HashRouter>
      ) : (
        <Login />
      )}
      <ContextMenuHost />
      <Toasts />
      <Dialogs />
    </>
  );
}
