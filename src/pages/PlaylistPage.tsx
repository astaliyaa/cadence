import { useParams } from "react-router-dom";
import { Ellipsis, ListMusic } from "lucide-react";
import { usePlaylist } from "../api/queries";
import { TrackTable } from "../components/TrackTable";
import { Artwork } from "../components/Artwork";
import { Empty, ErrorState, PlayButtons, Spinner } from "../components/Common";
import { formatDurationLong, plural } from "../lib/format";
import { playlistMenu } from "../lib/actions";
import { usePlayer } from "../player/store";
import { showMenu } from "../store/ui";

export function PlaylistPage() {
  const { id } = useParams();
  const { data: pl, isLoading, error, refetch } = usePlaylist(id);
  const playList = usePlayer((s) => s.playList);

  if (isLoading) return <Spinner />;
  if (error || !pl) return <ErrorState error={error ?? "Playlist not found"} retry={refetch} />;

  const songs = pl.entry ?? [];
  const source = { kind: "playlist" as const, id: pl.id, name: pl.name };

  return (
    <div className="page playlist-page">
      <header className="detail-header">
        <div className="detail-art">
          {pl.coverArt ? (
            <Artwork id={pl.coverArt} size={300} eager large />
          ) : (
            <div className="artwork">
              <div className="artwork-placeholder">
                <ListMusic size={64} strokeWidth={1.2} />
              </div>
            </div>
          )}
        </div>
        <div className="detail-info">
          <h1 className="detail-title">{pl.name}</h1>
          <div className="detail-artist muted">{pl.owner ? `Playlist · ${pl.owner}` : "Playlist"}</div>
          {pl.comment && <p className="detail-desc">{pl.comment}</p>}
          <div className="detail-meta">
            {plural(pl.songCount, "song")} · {formatDurationLong(pl.duration)}
          </div>
          <div className="detail-actions">
            <PlayButtons disabled={!songs.length} onPlay={() => playList(songs, 0, { source })} onShuffle={() => playList(songs, 0, { shuffle: true, source })} />
            <div className="detail-actions-right">
              <button className="circle-btn" onClick={(e) => showMenu(e, playlistMenu(pl))} aria-label="More">
                <Ellipsis size={18} />
              </button>
            </div>
          </div>
        </div>
      </header>
      {songs.length ? (
        <TrackTable songs={songs} variant="list" source={source} playlist={pl} showHeader virtual={songs.length > 150} />
      ) : (
        <Empty title="This playlist is empty">Right-click any song and choose “Add to Playlist”, or drag songs onto the playlist in the sidebar.</Empty>
      )}
    </div>
  );
}
