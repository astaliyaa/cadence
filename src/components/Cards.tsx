import { memo } from "react";
import { Link } from "react-router-dom";
import { Ellipsis, ListMusic } from "lucide-react";
import type { Album, Artist, Playlist } from "../api/types";
import { albumMenu, artistMenu, playAlbum, playArtist, playPlaylist, playlistMenu } from "../lib/actions";
import { showMenu } from "../store/ui";
import { albumArtist, isExplicit } from "../lib/format";
import { usePlayer } from "../player/store";
import { Artwork } from "./Artwork";
import { ExplicitBadge, PauseIcon, PlayIcon } from "./icons";

function HoverPlay({ onPlay, active }: { onPlay: () => void; active?: boolean }) {
  const playing = usePlayer((s) => s.playing);
  const togglePlay = usePlayer((s) => s.togglePlay);
  const isPlaying = active && playing;
  return (
    <button
      className={`card-play${active ? " active" : ""}`}
      aria-label={isPlaying ? "Pause" : "Play"}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (active) togglePlay();
        else onPlay();
      }}
    >
      {isPlaying ? <PauseIcon size={16} /> : <PlayIcon size={16} />}
    </button>
  );
}

function HoverMore({ onClick }: { onClick: (e: React.MouseEvent) => void }) {
  return (
    <button
      className="card-more"
      aria-label="More"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick(e);
      }}
    >
      <Ellipsis size={16} />
    </button>
  );
}

export const AlbumCard = memo(function AlbumCard({ album, size = 180, subtitle }: { album: Album; size?: number; subtitle?: "artist" | "year" }) {
  const active = usePlayer((s) => s.items[s.index]?.song.albumId === album.id);
  return (
    <Link to={`/album/${album.id}`} className="card" draggable={false} onContextMenu={(e) => showMenu(e, albumMenu(album))}>
      <div className="card-art">
        <Artwork id={album.coverArt} size={size} alt={album.name} />
        <div className="card-hover">
          <HoverPlay active={active} onPlay={() => playAlbum(album.id)} />
          <HoverMore onClick={(e) => showMenu(e, albumMenu(album))} />
        </div>
      </div>
      <div className="card-title">
        <span className="truncate">{album.name}</span>
        {isExplicit(album) && <ExplicitBadge />}
      </div>
      <div className="card-sub truncate">{subtitle === "year" ? album.year ?? "" : albumArtist(album)}</div>
    </Link>
  );
});

export const ArtistCard = memo(function ArtistCard({ artist, size = 160 }: { artist: Artist; size?: number }) {
  return (
    <Link to={`/artist/${artist.id}`} className="card artist-card" draggable={false} onContextMenu={(e) => showMenu(e, artistMenu(artist))}>
      <div className="card-art round">
        <Artwork id={artist.coverArt ?? `ar-${artist.id}`} size={size} round kind="artist" alt={artist.name} />
        <div className="card-hover">
          <HoverPlay onPlay={() => playArtist(artist)} />
        </div>
      </div>
      <div className="card-title center truncate">{artist.name}</div>
    </Link>
  );
});

export const PlaylistCard = memo(function PlaylistCard({ playlist, size = 180 }: { playlist: Playlist; size?: number }) {
  return (
    <Link to={`/playlist/${playlist.id}`} className="card" draggable={false} onContextMenu={(e) => showMenu(e, playlistMenu(playlist))}>
      <div className="card-art">
        {playlist.coverArt ? (
          <Artwork id={playlist.coverArt} size={size} alt={playlist.name} />
        ) : (
          <div className="artwork">
            <div className="artwork-placeholder">
              <ListMusic size={40} strokeWidth={1.4} />
            </div>
          </div>
        )}
        <div className="card-hover">
          <HoverPlay onPlay={() => playPlaylist(playlist.id)} />
          <HoverMore onClick={(e) => showMenu(e, playlistMenu(playlist))} />
        </div>
      </div>
      <div className="card-title truncate">{playlist.name}</div>
      <div className="card-sub truncate">{playlist.songCount} songs</div>
    </Link>
  );
});
