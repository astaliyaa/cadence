import { useEffect, useRef, useState } from "react";
import { NavLink, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { Clock3, Disc3, Heart, House, ListMusic, Mic2, Music2, Plus, Search, Settings, Shapes, X } from "lucide-react";
import { usePlaylists } from "../api/queries";
import { newPlaylist, playlistMenu, addToPlaylist } from "../lib/actions";
import { showMenu } from "../store/ui";
import type { Song } from "../api/types";

function Item({ to, icon, children, end }: { to: string; icon: React.ReactNode; children: React.ReactNode; end?: boolean }) {
  return (
    <NavLink to={to} end={end} className={({ isActive }) => `side-item${isActive ? " active" : ""}`} draggable={false}>
      <span className="side-icon">{icon}</span>
      <span className="truncate">{children}</span>
    </NavLink>
  );
}

function SearchField() {
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const onSearch = location.pathname === "/search";
  const [value, setValue] = useState(onSearch ? params.get("q") ?? "" : "");
  const ref = useRef<HTMLInputElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    if (!onSearch) setValue("");
  }, [onSearch]);

  useEffect(() => {
    const focus = () => {
      ref.current?.focus();
      ref.current?.select();
    };
    window.addEventListener("cadence:focus-search", focus);
    return () => window.removeEventListener("cadence:focus-search", focus);
  }, []);

  const update = (v: string) => {
    setValue(v);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      navigate(`/search?q=${encodeURIComponent(v)}`, { replace: onSearch });
    }, 220);
  };

  return (
    <div className="search-field">
      <Search size={14} className="search-icon" />
      <input
        ref={ref}
        value={value}
        placeholder="Search"
        spellCheck={false}
        onChange={(e) => update(e.target.value)}
        onFocus={() => !onSearch && navigate("/search")}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            update("");
            ref.current?.blur();
          }
        }}
      />
      {value && (
        <button className="search-clear" onClick={() => update("")} aria-label="Clear search">
          <X size={11} strokeWidth={3} />
        </button>
      )}
    </div>
  );
}

export function Sidebar() {
  const { data: playlists } = usePlaylists();
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  return (
    <aside className="sidebar">
      <div className="sidebar-top" data-tauri-drag-region />
      <SearchField />
      <nav className="side-nav">
        <Item to="/" end icon={<House size={17} />}>
          Home
        </Item>

        <div className="side-section">Library</div>
        <Item to="/library/recent" icon={<Clock3 size={17} />}>
          Recently Added
        </Item>
        <Item to="/library/artists" icon={<Mic2 size={17} />}>
          Artists
        </Item>
        <Item to="/library/albums" icon={<Disc3 size={17} />}>
          Albums
        </Item>
        <Item to="/library/songs" icon={<Music2 size={17} />}>
          Songs
        </Item>
        <Item to="/library/genres" icon={<Shapes size={17} />}>
          Genres
        </Item>
        <Item to="/library/favorites" icon={<Heart size={17} />}>
          Favorites
        </Item>

        <div className="side-section with-action">
          <span>Playlists</span>
          <button className="icon-btn tiny" onClick={() => newPlaylist()} title="New Playlist" aria-label="New Playlist">
            <Plus size={14} />
          </button>
        </div>
        {playlists?.map((pl) => (
          <div
            key={pl.id}
            onContextMenu={(e) => showMenu(e, playlistMenu(pl))}
            className={dropTarget === pl.id ? "drop-target" : undefined}
            onDragOver={(e) => {
              if (e.dataTransfer.types.includes("application/x-cadence-songs")) {
                e.preventDefault();
                setDropTarget(pl.id);
              }
            }}
            onDragLeave={() => setDropTarget(null)}
            onDrop={(e) => {
              setDropTarget(null);
              const raw = e.dataTransfer.getData("application/x-cadence-songs");
              if (!raw) return;
              const songs = JSON.parse(raw) as Song[];
              addToPlaylist(pl, songs.map((s) => s.id));
            }}
          >
            <Item to={`/playlist/${pl.id}`} icon={<ListMusic size={17} />}>
              {pl.name}
            </Item>
          </div>
        ))}
      </nav>
      <div className="sidebar-bottom">
        <Item to="/settings" icon={<Settings size={17} />}>
          Settings
        </Item>
      </div>
    </aside>
  );
}
