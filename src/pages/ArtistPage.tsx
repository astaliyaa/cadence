import { useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { Ellipsis } from "lucide-react";
import { useArtist, useArtistInfo, useTopSongs } from "../api/queries";
import type { Album, ArtistWithAlbums } from "../api/types";
import { AlbumCard, ArtistCard } from "../components/Cards";
import { Shelf } from "../components/Shelf";
import { TrackTable } from "../components/TrackTable";
import { ErrorState, Spinner } from "../components/Common";
import { PlayIcon } from "../components/icons";
import { useCoverUrl } from "../components/Artwork";
import { artistMenu, playArtist } from "../lib/actions";
import { stripHtml } from "../lib/format";
import { showMenu } from "../store/ui";

function splitReleases(albums: Album[]) {
  const by = (a: Album, b: Album) => (b.year ?? 0) - (a.year ?? 0);
  const isSingle = (a: Album) => a.releaseTypes?.some((t) => /single|ep/i.test(t));
  const isComp = (a: Album) => a.isCompilation || a.releaseTypes?.some((t) => /compilation/i.test(t));
  const main = albums.filter((a) => !isSingle(a) && !isComp(a)).sort(by);
  const singles = albums.filter(isSingle).sort(by);
  const comps = albums.filter((a) => !isSingle(a) && isComp(a)).sort(by);
  return { main, singles, comps };
}

function Hero({ artist, fallbackCover }: { artist: ArtistWithAlbums; fallbackCover?: string }) {
  const [broken, setBroken] = useState(false);
  const artistImg = useCoverUrl(artist.coverArt ?? `ar-${artist.id}`, 1200, true);
  // Only shown heavily blurred, so a small copy is plenty.
  const albumImg = useCoverUrl(fallbackCover, 300);
  const src = !broken ? artistImg : albumImg;
  return (
    <header className={`artist-hero${broken ? " from-album" : ""}`}>
      {src && <img src={src} alt="" draggable={false} onError={() => setBroken(true)} />}
      <div className="artist-hero-shade" />
      <div className="artist-hero-content">
        <button className="hero-play" onClick={() => playArtist(artist)} aria-label={`Shuffle ${artist.name}`}>
          <PlayIcon size={22} />
        </button>
        <h1>{artist.name}</h1>
        <button className="circle-btn on-dark" onClick={(e) => showMenu(e, artistMenu(artist))} aria-label="More">
          <Ellipsis size={18} />
        </button>
      </div>
    </header>
  );
}

export function ArtistView({ id, compact }: { id: string; compact?: boolean }) {
  const { data: artist, isLoading, error, refetch } = useArtist(id);
  const { data: info } = useArtistInfo(compact ? undefined : id);
  const { data: top } = useTopSongs(compact ? undefined : artist?.name);
  const [bioOpen, setBioOpen] = useState(false);
  const releases = useMemo(() => splitReleases(artist?.album ?? []), [artist]);

  if (isLoading) return <Spinner />;
  if (error || !artist) return <ErrorState error={error ?? "Artist not found"} retry={refetch} />;

  const bio = info?.biography ? stripHtml(info.biography) : "";
  const source = { kind: "artist" as const, id: artist.id, name: artist.name };

  return (
    <div className={`artist-view${compact ? " compact" : ""}`}>
      {compact ? (
        <div className="artist-compact-head">
          <h1 className="page-title">{artist.name}</h1>
          <button className="btn accent" onClick={() => playArtist(artist)}>
            <PlayIcon size={13} /> Shuffle
          </button>
        </div>
      ) : (
        <Hero artist={artist} fallbackCover={releases.main[0]?.coverArt ?? artist.album?.[0]?.coverArt} />
      )}

      <div className={compact ? "" : "page artist-body"}>
        {top && top.length > 0 && (
          <section className="top-songs">
            <h2 className="shelf-title">Top Songs</h2>
            <div className="top-songs-grid">
              <TrackTable songs={top.slice(0, 10)} variant="compact" source={{ ...source, name: `${artist.name} — Top Songs` }} />
            </div>
          </section>
        )}

        {compact ? (
          <div className="grid-static">
            {[...releases.main, ...releases.singles, ...releases.comps].map((a) => (
              <AlbumCard key={a.id} album={a} subtitle="year" />
            ))}
          </div>
        ) : (
          <>
            {releases.main.length > 0 && (
              <Shelf title="Albums">
                {releases.main.map((a) => (
                  <div className="shelf-item" key={a.id}>
                    <AlbumCard album={a} subtitle="year" />
                  </div>
                ))}
              </Shelf>
            )}
            {releases.singles.length > 0 && (
              <Shelf title="Singles & EPs">
                {releases.singles.map((a) => (
                  <div className="shelf-item" key={a.id}>
                    <AlbumCard album={a} subtitle="year" />
                  </div>
                ))}
              </Shelf>
            )}
            {releases.comps.length > 0 && (
              <Shelf title="Compilations">
                {releases.comps.map((a) => (
                  <div className="shelf-item" key={a.id}>
                    <AlbumCard album={a} subtitle="year" />
                  </div>
                ))}
              </Shelf>
            )}
          </>
        )}

        {!compact && bio && (
          <section className="about">
            <h2 className="shelf-title">About {artist.name}</h2>
            <div className={`about-text${bioOpen ? " open" : ""}`}>{bio}</div>
            {bio.length > 420 && (
              <button className="link" onClick={() => setBioOpen(!bioOpen)}>
                {bioOpen ? "Less" : "More"}
              </button>
            )}
          </section>
        )}

        {!compact && info?.similarArtist && info.similarArtist.length > 0 && (
          <Shelf title="Similar Artists">
            {info.similarArtist.map((a) => (
              <div className="shelf-item artist" key={a.id}>
                <ArtistCard artist={a} />
              </div>
            ))}
          </Shelf>
        )}
      </div>
    </div>
  );
}

export function ArtistPage() {
  const { id } = useParams();
  return <ArtistView key={id} id={id!} />;
}
