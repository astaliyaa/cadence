import { memo, useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Ellipsis, Heart } from "lucide-react";
import type { Playlist, Song } from "../api/types";
import { usePlayer, type PlaySource } from "../player/store";
import { useFavorites, useIsLoved } from "../store/favorites";
import { showMenu } from "../store/ui";
import { songMenu } from "../lib/actions";
import { formatTime, isExplicit, songArtist } from "../lib/format";
import { useScrollElement } from "../lib/scroll";
import { Artwork } from "./Artwork";
import { ExplicitBadge, NowPlayingBars, PauseIcon, PlayIcon } from "./icons";

export type TrackVariant = "album" | "list" | "compact";

interface Props {
  songs: Song[];
  variant: TrackVariant;
  source?: PlaySource;
  playlist?: Playlist;
  /** Album artist, so per-track artists are only shown when they differ. */
  albumArtist?: string;
  discTitles?: { disc: number; title: string }[];
  virtual?: boolean;
  onEndReached?: () => void;
  showHeader?: boolean;
}

type Row = { type: "disc"; disc: number; title?: string } | { type: "song"; song: Song; index: number };

const ROW_H = { album: 44, list: 52, compact: 56 } as const;

const TrackRow = memo(function TrackRow({
  song,
  index,
  variant,
  selected,
  albumArtist,
  onSelect,
  onPlay,
  onMenu,
  onDragStart,
}: {
  song: Song;
  index: number;
  variant: TrackVariant;
  selected: boolean;
  albumArtist?: string;
  onSelect: (index: number, e: React.MouseEvent) => void;
  onPlay: (index: number) => void;
  onMenu: (index: number, e: React.MouseEvent) => void;
  onDragStart: (index: number, e: React.DragEvent) => void;
}) {
  const isCurrent = usePlayer((s) => s.items[s.index]?.song.id === song.id);
  const playing = usePlayer((s) => s.playing);
  const togglePlay = usePlayer((s) => s.togglePlay);
  const loved = useIsLoved(song.id, song.starred);
  const toggleFav = useFavorites((s) => s.toggle);
  const artist = songArtist(song);
  const showArtist = variant === "album" && albumArtist && artist !== albumArtist;

  const lead =
    variant === "album" ? (
      <div className="tt-num">
        {isCurrent ? <NowPlayingBars paused={!playing} /> : <span className="tt-num-text">{song.track ?? index + 1}</span>}
        <button
          className="tt-play"
          aria-label={isCurrent && playing ? "Pause" : "Play"}
          onClick={(e) => {
            e.stopPropagation();
            if (isCurrent) togglePlay();
            else onPlay(index);
          }}
        >
          {isCurrent && playing ? <PauseIcon size={13} /> : <PlayIcon size={13} />}
        </button>
      </div>
    ) : (
      <div className="tt-art">
        <Artwork id={song.coverArt} size={variant === "compact" ? 44 : 38} />
        <button
          className={`tt-art-play${isCurrent ? " current" : ""}`}
          aria-label={isCurrent && playing ? "Pause" : "Play"}
          onClick={(e) => {
            e.stopPropagation();
            if (isCurrent) togglePlay();
            else onPlay(index);
          }}
        >
          {isCurrent && !playing ? <PlayIcon size={14} /> : isCurrent ? <NowPlayingBars /> : <PlayIcon size={14} />}
        </button>
      </div>
    );

  return (
    <div
      className={`tt-row ${variant}${selected ? " selected" : ""}${isCurrent ? " current" : ""}`}
      onClick={(e) => onSelect(index, e)}
      onDoubleClick={() => onPlay(index)}
      onContextMenu={(e) => onMenu(index, e)}
      draggable
      onDragStart={(e) => onDragStart(index, e)}
    >
      {lead}
      <div className="tt-title">
        <div className="tt-title-line">
          <span className="truncate">{song.title}</span>
          {isExplicit(song) && <ExplicitBadge />}
        </div>
        {(variant === "compact" || showArtist) && <div className="tt-sub truncate">{artist}</div>}
      </div>
      {variant === "list" && (
        <div className="tt-col truncate">
          {song.artistId ? (
            <Link to={`/artist/${song.artistId}`} className="sublink" onClick={(e) => e.stopPropagation()}>
              {artist}
            </Link>
          ) : (
            artist
          )}
        </div>
      )}
      {variant !== "album" && (
        <div className="tt-col truncate">
          {song.albumId ? (
            <Link to={`/album/${song.albumId}`} className="sublink" onClick={(e) => e.stopPropagation()}>
              {song.album}
            </Link>
          ) : (
            song.album
          )}
        </div>
      )}
      <button
        className={`tt-love${loved ? " on" : ""}`}
        aria-label={loved ? "Undo Favorite" : "Favorite"}
        onClick={(e) => {
          e.stopPropagation();
          toggleFav("song", song.id, loved);
        }}
      >
        <Heart size={14} fill={loved ? "currentColor" : "none"} />
      </button>
      <div className="tt-time">{formatTime(song.duration)}</div>
      <button
        className="tt-more"
        aria-label="More"
        onClick={(e) => {
          e.stopPropagation();
          onMenu(index, e);
        }}
      >
        <Ellipsis size={16} />
      </button>
    </div>
  );
});

export function TrackTable({ songs, variant, source, playlist, albumArtist, discTitles, virtual, onEndReached, showHeader }: Props) {
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const anchor = useRef<number | null>(null);
  const playList = usePlayer((s) => s.playList);

  const rows = useMemo<Row[]>(() => {
    const discs = new Set(songs.map((s) => s.discNumber ?? 1));
    const out: Row[] = [];
    let lastDisc: number | undefined;
    songs.forEach((song, index) => {
      const d = song.discNumber ?? 1;
      if (variant === "album" && discs.size > 1 && d !== lastDisc) {
        out.push({ type: "disc", disc: d, title: discTitles?.find((t) => t.disc === d)?.title });
        lastDisc = d;
      }
      out.push({ type: "song", song, index });
    });
    return out;
  }, [songs, variant, discTitles]);

  const onPlay = useCallback((index: number) => playList(songs, index, { source }), [songs, playList, source]);

  const onSelect = useCallback((index: number, e: React.MouseEvent) => {
    setSelected((prev) => {
      if (e.shiftKey && anchor.current !== null) {
        const [a, b] = [anchor.current, index].sort((x, y) => x - y);
        const next = new Set<number>();
        for (let i = a; i <= b; i++) next.add(i);
        return next;
      }
      anchor.current = index;
      if (e.ctrlKey || e.metaKey) {
        const next = new Set(prev);
        if (next.has(index)) next.delete(index);
        else next.add(index);
        return next;
      }
      return new Set([index]);
    });
  }, []);

  const targets = useCallback(
    (index: number) => (selected.has(index) && selected.size > 1 ? [...selected].sort((a, b) => a - b).map((i) => songs[i]) : [songs[index]]),
    [selected, songs],
  );

  const onMenu = useCallback(
    (index: number, e: React.MouseEvent) => {
      if (!selected.has(index)) setSelected(new Set([index]));
      const list = selected.has(index) ? targets(index) : [songs[index]];
      showMenu(e, songMenu(list, { playlist, playlistIndex: list.length === 1 ? index : undefined, hideAlbum: variant === "album" }));
    },
    [selected, targets, songs, playlist, variant],
  );

  const onDragStart = useCallback(
    (index: number, e: React.DragEvent) => {
      const list = selected.has(index) ? targets(index) : [songs[index]];
      e.dataTransfer.effectAllowed = "copy";
      e.dataTransfer.setData("application/x-cadence-songs", JSON.stringify(list));
      e.dataTransfer.setData("text/plain", list.map((s) => `${s.title} — ${songArtist(s)}`).join("\n"));
    },
    [selected, targets, songs],
  );

  const renderRow = (row: Row) =>
    row.type === "disc" ? (
      <div className="tt-disc">
        Disc {row.disc}
        {row.title ? ` — ${row.title}` : ""}
      </div>
    ) : (
      <TrackRow
        song={row.song}
        index={row.index}
        variant={variant}
        selected={selected.has(row.index)}
        albumArtist={albumArtist}
        onSelect={onSelect}
        onPlay={onPlay}
        onMenu={onMenu}
        onDragStart={onDragStart}
      />
    );

  const header = showHeader && variant === "list" && (
    <div className="tt-header list">
      <div />
      <div>Title</div>
      <div>Artist</div>
      <div>Album</div>
      <div />
      <div className="tt-time">Time</div>
      <div />
    </div>
  );

  if (virtual) {
    return (
      <>
        {header}
        <VirtualRows rows={rows} height={ROW_H[variant]} render={renderRow} onEndReached={onEndReached} />
      </>
    );
  }

  return (
    <div className={`track-table ${variant}`} onKeyDown={(e) => e.key === "Escape" && setSelected(new Set())}>
      {header}
      {rows.map((row) => (
        <div key={row.type === "disc" ? `d${row.disc}` : `${row.song.id}:${row.index}`}>{renderRow(row)}</div>
      ))}
    </div>
  );
}

function VirtualRows({ rows, height, render, onEndReached }: { rows: Row[]; height: number; render: (r: Row) => React.ReactNode; onEndReached?: () => void }) {
  const scrollEl = useScrollElement();
  const ref = useRef<HTMLDivElement>(null);
  const [margin, setMargin] = useState(0);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !scrollEl) return;
    setMargin(el.getBoundingClientRect().top - scrollEl.getBoundingClientRect().top + scrollEl.scrollTop);
  }, [scrollEl]);

  const v = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollEl,
    estimateSize: () => height,
    overscan: 12,
    scrollMargin: margin,
  });
  const items = v.getVirtualItems();
  const last = items[items.length - 1];
  const nearEnd = !!last && last.index >= rows.length - 20;
  const endRef = useRef(onEndReached);
  endRef.current = onEndReached;
  useLayoutEffect(() => {
    if (nearEnd) endRef.current?.();
  }, [nearEnd, rows.length]);

  return (
    <div ref={ref} className="track-table virtual" style={{ height: v.getTotalSize(), position: "relative" }}>
      {items.map((it) => (
        <div key={it.key} style={{ position: "absolute", top: 0, left: 0, right: 0, height, transform: `translateY(${it.start - margin}px)` }}>
          {render(rows[it.index])}
        </div>
      ))}
    </div>
  );
}
