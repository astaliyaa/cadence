import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ChevronDown, Heart, Shapes } from "lucide-react";
import { useArtists, useGenres, useInfiniteAlbums, useInfiniteSongs, useStarred } from "../api/queries";
import type { AlbumListType, Artist } from "../api/types";
import { AlbumCard, ArtistCard } from "../components/Cards";
import { VirtualGrid } from "../components/VirtualGrid";
import { TrackTable } from "../components/TrackTable";
import { Artwork } from "../components/Artwork";
import { Empty, ErrorState, PageTitle, PlayButtons, Segmented, Spinner } from "../components/Common";
import { ArtistView } from "./ArtistPage";
import { hashHue, plural } from "../lib/format";
import { artistMenu } from "../lib/actions";
import { api } from "../store/auth";
import { showMenu, useUI } from "../store/ui";
import { usePlayer } from "../player/store";

// ---- albums ---------------------------------------------------------------

const SORTS: { type: AlbumListType; label: string; extra?: Record<string, string | number> }[] = [
  { type: "newest", label: "Recently Added" },
  { type: "alphabeticalByName", label: "Title" },
  { type: "alphabeticalByArtist", label: "Artist" },
  { type: "byYear", label: "Release Date", extra: { fromYear: 3000, toYear: 0 } },
  { type: "frequent", label: "Most Played" },
  { type: "recent", label: "Recently Played" },
  { type: "highest", label: "Top Rated" },
];

function AlbumGrid({ type, extra }: { type: AlbumListType; extra?: Record<string, string | number> }) {
  const q = useInfiniteAlbums(type, extra);
  const albums = useMemo(() => q.data?.pages.flat() ?? [], [q.data]);
  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorState error={q.error} retry={q.refetch} />;
  if (!albums.length) return <Empty title="No albums here yet" />;
  return (
    <VirtualGrid
      items={albums}
      getKey={(a) => a.id}
      render={(a, w) => <AlbumCard album={a} size={w} />}
      onEndReached={() => q.hasNextPage && !q.isFetchingNextPage && q.fetchNextPage()}
    />
  );
}

export function AlbumsPage() {
  const [params, setParams] = useSearchParams();
  const sort = SORTS.find((s) => s.type === params.get("sort")) ?? SORTS[1];
  const openMenu = useUI((s) => s.openMenu);
  return (
    <div className="page">
      <PageTitle
        actions={
          <button
            className="btn ghost"
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              openMenu(
                r.left,
                r.bottom + 4,
                SORTS.map((s) => ({ label: s.label, checked: s.type === sort.type, onSelect: () => setParams({ sort: s.type }, { replace: true }) })),
              );
            }}
          >
            Sort by {sort.label} <ChevronDown size={14} />
          </button>
        }
      >
        Albums
      </PageTitle>
      <AlbumGrid key={sort.type} type={sort.type} extra={sort.extra} />
    </div>
  );
}

const LIST_TITLES: Partial<Record<AlbumListType, string>> = {
  newest: "Recently Added",
  recent: "Recently Played",
  frequent: "Most Played",
  random: "Discover",
  highest: "Top Rated",
  starred: "Favorite Albums",
};

export function AlbumListPage({ type: fixed }: { type?: AlbumListType }) {
  const params = useParams();
  const type = (fixed ?? params.type ?? "newest") as AlbumListType;
  return (
    <div className="page">
      <PageTitle>{LIST_TITLES[type] ?? "Albums"}</PageTitle>
      <AlbumGrid key={type} type={type} />
    </div>
  );
}

// ---- artists (two-pane, like the Library ▸ Artists view) --------------------

function ArtistRow({ artist, active }: { artist: Artist; active: boolean }) {
  return (
    <Link to={`/library/artists/${artist.id}`} className={`artist-row${active ? " active" : ""}`} onContextMenu={(e) => showMenu(e, artistMenu(artist))} draggable={false}>
      <Artwork id={artist.coverArt ?? `ar-${artist.id}`} size={32} round kind="artist" />
      <span className="truncate">{artist.name}</span>
    </Link>
  );
}

export function ArtistsPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data: artists, isLoading, error, refetch } = useArtists();
  const [filter, setFilter] = useState("");
  const listRef = useRef<HTMLDivElement>(null);

  const shown = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return f ? (artists ?? []).filter((a) => a.name.toLowerCase().includes(f)) : artists ?? [];
  }, [artists, filter]);

  useEffect(() => {
    if (!id && artists?.length) navigate(`/library/artists/${artists[0].id}`, { replace: true });
  }, [id, artists, navigate]);

  const v = useVirtualizer({ count: shown.length, getScrollElement: () => listRef.current, estimateSize: () => 44, overscan: 10 });

  if (isLoading) return <Spinner />;
  if (error) return <ErrorState error={error} retry={refetch} />;

  return (
    <div className="artists-split">
      <div className="artists-list-col">
        <input className="text-field filter" placeholder="Filter Artists" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <div ref={listRef} className="artists-list">
          <div style={{ height: v.getTotalSize(), position: "relative" }}>
            {v.getVirtualItems().map((it) => (
              <div key={it.key} style={{ position: "absolute", top: 0, left: 0, right: 0, transform: `translateY(${it.start}px)` }}>
                <ArtistRow artist={shown[it.index]} active={shown[it.index].id === id} />
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="artists-detail">{id && <ArtistView key={id} id={id} compact />}</div>
    </div>
  );
}

// ---- songs -------------------------------------------------------------------

export function SongsPage() {
  const q = useInfiniteSongs();
  const songs = useMemo(() => q.data?.pages.flat() ?? [], [q.data]);
  const playList = usePlayer((s) => s.playList);
  const source = { kind: "songs" as const, name: "Songs" };
  const shuffleAll = async () => {
    const random = await api().randomSongs(500);
    playList(random, 0, { shuffle: true, source });
  };
  return (
    <div className="page">
      <PageTitle actions={<PlayButtons disabled={!songs.length} onPlay={() => playList(songs, 0, { source })} onShuffle={shuffleAll} />}>Songs</PageTitle>
      {q.isLoading ? (
        <Spinner />
      ) : q.error ? (
        <ErrorState error={q.error} retry={q.refetch} />
      ) : (
        <TrackTable songs={songs} variant="list" source={source} showHeader virtual onEndReached={() => q.hasNextPage && !q.isFetchingNextPage && q.fetchNextPage()} />
      )}
    </div>
  );
}

// ---- genres ------------------------------------------------------------------

export function GenresPage() {
  const { data, isLoading, error, refetch } = useGenres();
  const genres = useMemo(() => (data ?? []).filter((g) => g.albumCount > 0).sort((a, b) => b.albumCount - a.albumCount), [data]);
  if (isLoading) return <Spinner />;
  if (error) return <ErrorState error={error} retry={refetch} />;
  return (
    <div className="page">
      <PageTitle>Genres</PageTitle>
      {!genres.length && <Empty icon={<Shapes size={36} />} title="No genres found" />}
      <div className="genre-grid">
        {genres.map((g) => {
          const h = hashHue(g.value);
          return (
            <Link
              key={g.value}
              to={`/genre/${encodeURIComponent(g.value)}`}
              className="genre-tile"
              style={{ background: `linear-gradient(135deg, hsl(${h} 70% 52%), hsl(${(h + 40) % 360} 75% 38%))` }}
            >
              <span className="genre-name">{g.value}</span>
              <span className="genre-count">{plural(g.albumCount, "album")}</span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

export function GenrePage() {
  const { name = "" } = useParams();
  const genre = decodeURIComponent(name);
  const playList = usePlayer((s) => s.playList);
  const play = async () => {
    const songs = await api().randomSongs(200, genre);
    playList(songs, 0, { source: { kind: "genre", name: genre } });
  };
  return (
    <div className="page">
      <PageTitle actions={<PlayButtons onPlay={play} />}>{genre}</PageTitle>
      <AlbumGrid key={genre} type="byGenre" extra={{ genre }} />
    </div>
  );
}

// ---- favorites -----------------------------------------------------------------

export function FavoritesPage() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get("tab") as "songs" | "albums" | "artists") ?? "songs";
  const { data, isLoading, error, refetch } = useStarred();
  const playList = usePlayer((s) => s.playList);
  const songs = data?.song ?? [];
  const source = { kind: "favorites" as const, name: "Favorite Songs" };

  return (
    <div className="page">
      <PageTitle
        actions={
          tab === "songs" ? <PlayButtons disabled={!songs.length} onPlay={() => playList(songs, 0, { source })} onShuffle={() => playList(songs, 0, { shuffle: true, source })} /> : undefined
        }
      >
        Favorites
      </PageTitle>
      <div className="tab-row">
        <Segmented
          value={tab}
          onChange={(t) => setParams({ tab: t }, { replace: true })}
          options={[
            { value: "songs", label: "Songs" },
            { value: "albums", label: "Albums" },
            { value: "artists", label: "Artists" },
          ]}
        />
      </div>
      {isLoading ? (
        <Spinner />
      ) : error ? (
        <ErrorState error={error} retry={refetch} />
      ) : tab === "songs" ? (
        songs.length ? (
          <TrackTable songs={songs} variant="list" source={source} showHeader virtual={songs.length > 150} />
        ) : (
          <Empty icon={<Heart size={36} />} title="No favorite songs yet">
            Tap the heart on any song to keep it here.
          </Empty>
        )
      ) : tab === "albums" ? (
        data?.album?.length ? (
          <VirtualGrid items={data.album} getKey={(a) => a.id} render={(a, w) => <AlbumCard album={a} size={w} />} />
        ) : (
          <Empty icon={<Heart size={36} />} title="No favorite albums yet" />
        )
      ) : data?.artist?.length ? (
        <VirtualGrid items={data.artist} footer={30} getKey={(a) => a.id} render={(a, w) => <ArtistCard artist={a} size={w} />} />
      ) : (
        <Empty icon={<Heart size={36} />} title="No favorite artists yet" />
      )}
    </div>
  );
}
