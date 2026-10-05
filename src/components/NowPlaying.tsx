import { useEffect, useState } from "react";
import { ChevronDown, Ellipsis, Heart } from "lucide-react";
import { useUI, showMenu } from "../store/ui";
import { useSettings } from "../store/settings";
import { useCurrentSong } from "../player/hooks";
import { usePlayer } from "../player/store";
import { useFavorites, useIsLoved } from "../store/favorites";
import { songMenu } from "../lib/actions";
import { isExplicit, qualityOf, songAlbumArtist, songArtist } from "../lib/format";
import { isMac, isWindows } from "../lib/platform";
import { WindowControls } from "./WindowControls";
import { go } from "../lib/nav";
import { LyricsView } from "../lyrics/LyricsView";
import { useLyrics } from "../lyrics/lyrics";
import { AmbientBackground } from "./AmbientBackground";
import { MotionArtwork } from "./MotionArtwork";
import { Scrubber } from "./Scrubber";
import { Transport, VolumeControl } from "./TopBar";
import { QueuePanel } from "./QueuePanel";
import { ExplicitBadge, LosslessIcon, LyricsIcon, QueueIcon } from "./icons";

export function NowPlaying() {
  const open = useUI((s) => s.nowPlayingOpen);
  const setOpen = useUI((s) => s.setNowPlaying);
  const [mounted, setMounted] = useState(open);

  useEffect(() => {
    if (open) setMounted(true);
    else {
      const t = setTimeout(() => setMounted(false), 420);
      return () => clearTimeout(t);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !useUI.getState().menu) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen]);

  if (!mounted) return null;
  return <NowPlayingView open={open} onClose={() => setOpen(false)} />;
}

function NowPlayingView({ open, onClose }: { open: boolean; onClose: () => void }) {
  const song = useCurrentSong();
  const playing = usePlayer((s) => s.playing);
  const animated = useSettings((s) => s.animatedBackground);
  const loved = useIsLoved(song?.id, song?.starred);
  const toggleFav = useFavorites((s) => s.toggle);
  const { data: lyrics } = useLyrics(song);
  const hasLyrics = !!lyrics?.lines.some((l) => l.text);
  const [side, setSide] = useState<"lyrics" | "queue" | null>("lyrics");
  const showSide = side === "queue" || (side === "lyrics" && hasLyrics);
  const quality = qualityOf(song);
  const [entered, setEntered] = useState(false);

  useEffect(() => {
    const r = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(r);
  }, []);

  const goTo = (path: string) => {
    onClose();
    go(path);
  };

  return (
    <div className={`now-playing${open && entered ? " open" : ""}${showSide ? " with-side" : ""}`} role="dialog" aria-label="Now Playing">
      <AmbientBackground coverId={song?.coverArt} paused={!open || !playing} still={!animated} />
      <div className="np-drag" data-tauri-drag-region />
      {isWindows && <WindowControls />}
      <button className={`np-close${isMac ? " mac" : ""}`} onClick={onClose} aria-label="Close Now Playing">
        <ChevronDown size={22} />
      </button>

      <div className="np-body">
        <section className="np-left">
          <div className={`np-art-wrap${playing ? " playing" : ""}`}>
            <MotionArtwork
              key={song?.albumId}
              albumId={song?.albumId}
              album={song?.album}
              artist={song ? songAlbumArtist(song) : undefined}
              coverId={song?.coverArt}
              size={560}
              large
              className="np-art"
            />
          </div>

          <div className="np-meta">
            <div className="np-titles">
              <div className="np-title">
                <span className="truncate">{song?.title ?? "Not Playing"}</span>
                {song && isExplicit(song) && <ExplicitBadge />}
              </div>
              {song && (
                <div className="np-artist truncate">
                  <button className="link" onClick={() => song.artistId && goTo(`/artist/${song.artistId}`)}>
                    {songArtist(song)}
                  </button>
                  {song.album && (
                    <>
                      {" — "}
                      <button className="link" onClick={() => song.albumId && goTo(`/album/${song.albumId}`)}>
                        {song.album}
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
            {song && (
              <div className="np-meta-actions">
                <button className={`np-round${loved ? " on" : ""}`} onClick={() => toggleFav("song", song.id, loved)} aria-label="Favorite">
                  <Heart size={17} fill={loved ? "currentColor" : "none"} />
                </button>
                <button className="np-round" onClick={(e) => showMenu(e, songMenu([song]))} aria-label="More">
                  <Ellipsis size={18} />
                </button>
              </div>
            )}
          </div>

          <Scrubber variant="full" />
          {quality && (
            <div className="np-quality">
              <LosslessIcon size={12} /> {quality}
            </div>
          )}
          <Transport size="large" />
          <div className="np-bottom">
            <VolumeControl className="np-volume" />
            <div className="np-side-toggles">
              <button className={`np-round small${side === "lyrics" ? " on" : ""}`} onClick={() => setSide(side === "lyrics" ? null : "lyrics")} aria-label="Lyrics" title="Lyrics">
                <LyricsIcon size={18} />
              </button>
              <button className={`np-round small${side === "queue" ? " on" : ""}`} onClick={() => setSide(side === "queue" ? null : "queue")} aria-label="Playing Next" title="Playing Next">
                <QueueIcon size={18} />
              </button>
            </div>
          </div>
        </section>

        <section className="np-right">
          {side === "queue" ? (
            <div className="np-queue">
              <QueuePanel />
            </div>
          ) : side === "lyrics" && hasLyrics ? (
            <LyricsView song={song} variant="full" />
          ) : null}
        </section>
      </div>
    </div>
  );
}
