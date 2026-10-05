import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useAlbumList, usePlaylists, useStarred } from "../api/queries";
import type { Album } from "../api/types";
import { AlbumCard, PlaylistCard } from "../components/Cards";
import { Shelf } from "../components/Shelf";
import { Artwork } from "../components/Artwork";
import { PageTitle, Spinner } from "../components/Common";
import { PlayIcon } from "../components/icons";
import { useArtworkTint } from "../lib/color";
import { albumArtist } from "../lib/format";
import { playAlbum, albumMenu } from "../lib/actions";
import { showMenu } from "../store/ui";

function greeting() {
  const h = new Date().getHours();
  if (h < 5) return "Good Night";
  if (h < 12) return "Good Morning";
  if (h < 18) return "Good Afternoon";
  return "Good Evening";
}

function PickCard({ label, album }: { label: string; album: Album }) {
  const tint = useArtworkTint(album.coverArt);
  return (
    <div className="pick">
      <div className="pick-label">{label}</div>
      <Link to={`/album/${album.id}`} className="pick-card" style={{ "--tint": tint } as React.CSSProperties} onContextMenu={(e) => showMenu(e, albumMenu(album))} draggable={false}>
        <div className="pick-art">
          <Artwork id={album.coverArt} size={300} alt={album.name} />
        </div>
        <div className="pick-info">
          <div className="pick-text">
            <div className="pick-title truncate">{album.name}</div>
            <div className="pick-sub truncate">{albumArtist(album)}</div>
          </div>
          <button
            className="pick-play"
            aria-label="Play"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              playAlbum(album.id);
            }}
          >
            <PlayIcon size={14} />
          </button>
        </div>
      </Link>
    </div>
  );
}

function AlbumShelf({ title, albums, seeAll }: { title: string; albums?: Album[]; seeAll?: string }) {
  if (!albums?.length) return null;
  return (
    <Shelf title={title} seeAll={seeAll}>
      {albums.map((a) => (
        <div className="shelf-item" key={a.id}>
          <AlbumCard album={a} />
        </div>
      ))}
    </Shelf>
  );
}

export function Home() {
  const recent = useAlbumList("recent", 24);
  const newest = useAlbumList("newest", 24);
  const frequent = useAlbumList("frequent", 24);
  const random = useAlbumList("random", 24);
  const starred = useStarred();
  const playlists = usePlaylists();

  const picks = useMemo(() => {
    const out: { label: string; album: Album }[] = [];
    const seen = new Set<string>();
    const pick = (label: string, list?: Album[]) => {
      const a = list?.find((x) => !seen.has(x.id));
      if (a) {
        seen.add(a.id);
        out.push({ label, album: a });
      }
    };
    const favs = starred.data?.album;
    pick("Recently Added", newest.data);
    pick("Most Played", frequent.data);
    pick("Rediscover", random.data);
    pick("From Your Favorites", favs?.length ? [favs[Math.floor(Math.random() * favs.length)]] : undefined);
    pick("Jump Back In", recent.data);
    return out;
  }, [newest.data, frequent.data, random.data, starred.data, recent.data]);

  const loading = recent.isLoading && newest.isLoading;

  return (
    <div className="page home">
      <PageTitle>{greeting()}</PageTitle>
      {loading && <Spinner />}
      {picks.length > 0 && (
        <Shelf title="Top Picks for You" className="picks-shelf">
          {picks.map((p) => (
            <PickCard key={p.album.id} label={p.label} album={p.album} />
          ))}
        </Shelf>
      )}
      <AlbumShelf title="Recently Played" albums={recent.data} seeAll="/albums/recent" />
      <AlbumShelf title="Recently Added" albums={newest.data} seeAll="/library/recent" />
      <AlbumShelf title="Most Played" albums={frequent.data} seeAll="/albums/frequent" />
      {playlists.data && playlists.data.length > 0 && (
        <Shelf title="Your Playlists">
          {playlists.data.map((pl) => (
            <div className="shelf-item" key={pl.id}>
              <PlaylistCard playlist={pl} />
            </div>
          ))}
        </Shelf>
      )}
      <AlbumShelf title="Favorite Albums" albums={starred.data?.album?.slice(0, 24)} seeAll="/library/favorites?tab=albums" />
      <AlbumShelf title="Discover Something" albums={random.data} seeAll="/albums/random" />
    </div>
  );
}
