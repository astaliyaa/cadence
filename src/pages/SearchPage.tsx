import { Link, useSearchParams } from "react-router-dom";
import { Search } from "lucide-react";
import { useGenres, useSearch } from "../api/queries";
import { AlbumCard, ArtistCard } from "../components/Cards";
import { Shelf } from "../components/Shelf";
import { TrackTable } from "../components/TrackTable";
import { Artwork } from "../components/Artwork";
import { Empty, PageTitle, Spinner } from "../components/Common";
import { PlayIcon } from "../components/icons";
import { albumArtist, hashHue } from "../lib/format";
import { playAlbum, playArtist } from "../lib/actions";

function Browse() {
  const { data } = useGenres();
  const genres = (data ?? []).filter((g) => g.albumCount > 0).sort((a, b) => b.albumCount - a.albumCount).slice(0, 24);
  return (
    <div className="page">
      <PageTitle>Search</PageTitle>
      {genres.length > 0 && (
        <>
          <h2 className="shelf-title static">Browse by Genre</h2>
          <div className="genre-grid">
            {genres.map((g) => {
              const h = hashHue(g.value);
              return (
                <Link key={g.value} to={`/genre/${encodeURIComponent(g.value)}`} className="genre-tile" style={{ background: `linear-gradient(135deg, hsl(${h} 70% 52%), hsl(${(h + 40) % 360} 75% 38%))` }}>
                  <span className="genre-name">{g.value}</span>
                </Link>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

export function SearchPage() {
  const [params] = useSearchParams();
  const q = (params.get("q") ?? "").trim();
  const { data, isFetching, isLoading } = useSearch(q);

  if (!q) return <Browse />;

  const artists = data?.artist ?? [];
  const albums = data?.album ?? [];
  const songs = data?.song ?? [];
  const nothing = !isFetching && !artists.length && !albums.length && !songs.length;

  // Top result: an exact-ish artist match beats an album, which beats the first song.
  const ql = q.toLowerCase();
  const topArtist = artists.find((a) => a.name.toLowerCase() === ql) ?? (artists[0]?.name.toLowerCase().startsWith(ql) ? artists[0] : undefined);
  const topAlbum = !topArtist ? albums.find((a) => a.name.toLowerCase().startsWith(ql)) ?? albums[0] : undefined;

  return (
    <div className="page search-page">
      <PageTitle>
        Results for “{q}”
      </PageTitle>
      {isLoading && <Spinner />}
      {nothing && (
        <Empty icon={<Search size={36} />} title="No Results">
          Try a different spelling or search for something else.
        </Empty>
      )}

      {(topArtist || topAlbum || songs.length > 0) && (
        <div className="search-top">
          {(topArtist || topAlbum) && (
            <section className="top-result">
              <h2 className="shelf-title static">Top Result</h2>
              {topArtist ? (
                <Link to={`/artist/${topArtist.id}`} className="top-result-card">
                  <Artwork id={topArtist.coverArt ?? `ar-${topArtist.id}`} size={110} round kind="artist" />
                  <div className="top-result-name">{topArtist.name}</div>
                  <div className="top-result-kind">Artist</div>
                  <button
                    className="pick-play"
                    onClick={(e) => {
                      e.preventDefault();
                      playArtist(topArtist);
                    }}
                    aria-label="Shuffle artist"
                  >
                    <PlayIcon size={14} />
                  </button>
                </Link>
              ) : (
                topAlbum && (
                  <Link to={`/album/${topAlbum.id}`} className="top-result-card">
                    <Artwork id={topAlbum.coverArt} size={110} />
                    <div className="top-result-name">{topAlbum.name}</div>
                    <div className="top-result-kind">Album · {albumArtist(topAlbum)}</div>
                    <button
                      className="pick-play"
                      onClick={(e) => {
                        e.preventDefault();
                        playAlbum(topAlbum.id);
                      }}
                      aria-label="Play album"
                    >
                      <PlayIcon size={14} />
                    </button>
                  </Link>
                )
              )}
            </section>
          )}
          {songs.length > 0 && (
            <section className="top-songs-col">
              <h2 className="shelf-title static">Songs</h2>
              <TrackTable songs={songs.slice(0, 4)} variant="compact" source={{ kind: "search", name: `“${q}”` }} />
            </section>
          )}
        </div>
      )}

      {artists.length > 0 && (
        <Shelf title="Artists">
          {artists.map((a) => (
            <div className="shelf-item artist" key={a.id}>
              <ArtistCard artist={a} />
            </div>
          ))}
        </Shelf>
      )}
      {albums.length > 0 && (
        <Shelf title="Albums">
          {albums.map((a) => (
            <div className="shelf-item" key={a.id}>
              <AlbumCard album={a} />
            </div>
          ))}
        </Shelf>
      )}
      {songs.length > 4 && (
        <section className="search-songs">
          <h2 className="shelf-title static">All Songs</h2>
          <TrackTable songs={songs} variant="list" source={{ kind: "search", name: `“${q}”` }} />
        </section>
      )}
    </div>
  );
}
