import { useMemo } from "react";
import { Link, useParams } from "react-router-dom";
import { Ellipsis, Heart } from "lucide-react";
import { useAlbum, useArtist } from "../api/queries";
import { TrackTable } from "../components/TrackTable";
import { MotionArtwork } from "../components/MotionArtwork";
import { AlbumCard } from "../components/Cards";
import { Shelf } from "../components/Shelf";
import { ErrorState, PlayButtons, Spinner } from "../components/Common";
import { ExplicitBadge, LosslessIcon } from "../components/icons";
import { albumArtist, formatDurationLong, isExplicit, plural, qualityOf, releaseDateLabel } from "../lib/format";
import { albumMenu } from "../lib/actions";
import { usePlayer } from "../player/store";
import { useFavorites, useIsLoved } from "../store/favorites";
import { showMenu } from "../store/ui";

export function AlbumPage() {
  const { id } = useParams();
  const { data: album, isLoading, error, refetch } = useAlbum(id);
  const { data: artist } = useArtist(album?.artistId);
  const loved = useIsLoved(album?.id, album?.starred);
  const toggleFav = useFavorites((s) => s.toggle);
  const playList = usePlayer((s) => s.playList);

  const songs = useMemo(() => album?.song ?? [], [album]);
  const quality = useMemo(() => {
    const qs = songs.map(qualityOf);
    if (qs.length && qs.every((q) => q === "Hi-Res Lossless")) return "Hi-Res Lossless";
    if (qs.length && qs.every((q) => q)) return "Lossless";
    return null;
  }, [songs]);

  if (isLoading) return <Spinner />;
  if (error || !album) return <ErrorState error={error ?? "Album not found"} retry={refetch} />;

  const artistName = albumArtist(album);
  const source = { kind: "album" as const, id: album.id, name: album.name };
  const genre = album.genres?.map((g) => g.name).slice(0, 2).join(", ") || album.genre;
  const meta = [genre?.toUpperCase(), album.year].filter(Boolean).join(" · ");
  const totalDuration = album.duration ?? songs.reduce((s, x) => s + (x.duration ?? 0), 0);
  const more = artist?.album?.filter((a) => a.id !== album.id) ?? [];
  const release = releaseDateLabel(album);
  const types = album.releaseTypes?.filter((t) => t.toLowerCase() !== "album");

  return (
    <div className="page album-page">
      <header className="detail-header">
        <MotionArtwork albumId={album.id} album={album.name} artist={artistName} coverId={album.coverArt} size={300} large className="detail-art" />
        <div className="detail-info">
          <h1 className="detail-title">
            {album.name}
            {isExplicit(album) && <ExplicitBadge />}
          </h1>
          <div className="detail-artist">
            {album.artistId ? <Link to={`/artist/${album.artistId}`}>{artistName}</Link> : artistName}
          </div>
          <div className="detail-meta">
            {meta}
            {types?.length ? ` · ${types.join(", ").toUpperCase()}` : ""}
            {quality && (
              <span className="quality-badge">
                <LosslessIcon size={11} /> {quality}
              </span>
            )}
          </div>
          <div className="detail-actions">
            <PlayButtons disabled={!songs.length} onPlay={() => playList(songs, 0, { source })} onShuffle={() => playList(songs, 0, { shuffle: true, source })} />
            <div className="detail-actions-right">
              <button className={`circle-btn${loved ? " on" : ""}`} onClick={() => toggleFav("album", album.id, loved)} aria-label="Favorite" title="Favorite">
                <Heart size={17} fill={loved ? "currentColor" : "none"} />
              </button>
              <button className="circle-btn" onClick={(e) => showMenu(e, albumMenu(album))} aria-label="More">
                <Ellipsis size={18} />
              </button>
            </div>
          </div>
        </div>
      </header>

      <TrackTable songs={songs} variant="album" source={source} albumArtist={artistName} discTitles={album.discTitles} />

      <footer className="detail-footer">
        {release && <div>{release}</div>}
        <div>
          {plural(songs.length, "song")}, {formatDurationLong(totalDuration)}
        </div>
        {album.recordLabels?.length ? <div>℗ {album.recordLabels.map((l) => l.name).join(", ")}</div> : null}
      </footer>

      {more.length > 0 && (
        <Shelf title={`More by ${artistName}`} seeAll={album.artistId ? `/artist/${album.artistId}` : undefined}>
          {more.map((a) => (
            <div className="shelf-item" key={a.id}>
              <AlbumCard album={a} subtitle="year" />
            </div>
          ))}
        </Shelf>
      )}
    </div>
  );
}
