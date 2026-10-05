import { Ellipsis, Repeat, Repeat1, Shuffle, Volume1, Volume2, VolumeX } from "lucide-react";
import { usePlayer } from "../player/store";
import { useCurrentSong } from "../player/hooks";
import { useUI, showMenu } from "../store/ui";
import { songMenu } from "../lib/actions";
import { isExplicit, songArtist } from "../lib/format";
import { isWindows } from "../lib/platform";
import { go } from "../lib/nav";
import { Artwork } from "./Artwork";
import { Scrubber, VolumeSlider } from "./Scrubber";
import { WindowControls } from "./WindowControls";
import { BackwardIcon, ExplicitBadge, ForwardIcon, LyricsIcon, PauseIcon, PlayIcon, QueueIcon } from "./icons";

export function Transport({ size = "small" }: { size?: "small" | "large" }) {
  const playing = usePlayer((s) => s.playing);
  const buffering = usePlayer((s) => s.buffering);
  const shuffle = usePlayer((s) => s.shuffle);
  const repeat = usePlayer((s) => s.repeat);
  const has = usePlayer((s) => s.index >= 0 && s.items.length > 0);
  const p = usePlayer.getState();
  const big = size === "large";
  return (
    <div className={`transport ${size}`}>
      <button className={`icon-btn toggle${shuffle ? " on" : ""}`} onClick={p.toggleShuffle} aria-label="Shuffle" title="Shuffle">
        <Shuffle size={big ? 20 : 15} strokeWidth={2.2} />
      </button>
      <button className="icon-btn" onClick={p.previous} disabled={!has} aria-label="Previous" title="Previous">
        <BackwardIcon size={big ? 34 : 22} />
      </button>
      <button className={`icon-btn play${buffering && playing ? " buffering" : ""}`} onClick={p.togglePlay} disabled={!has} aria-label={playing ? "Pause" : "Play"} title={playing ? "Pause" : "Play"}>
        {playing ? <PauseIcon size={big ? 40 : 24} /> : <PlayIcon size={big ? 40 : 24} />}
      </button>
      <button className="icon-btn" onClick={() => p.next()} disabled={!has} aria-label="Next" title="Next">
        <ForwardIcon size={big ? 34 : 22} />
      </button>
      <button className={`icon-btn toggle${repeat !== "off" ? " on" : ""}`} onClick={p.cycleRepeat} aria-label={`Repeat ${repeat}`} title="Repeat">
        {repeat === "one" ? <Repeat1 size={big ? 20 : 15} strokeWidth={2.2} /> : <Repeat size={big ? 20 : 15} strokeWidth={2.2} />}
      </button>
    </div>
  );
}

export function VolumeControl({ className = "" }: { className?: string }) {
  const volume = usePlayer((s) => s.volume);
  const muted = usePlayer((s) => s.muted);
  const toggleMute = usePlayer((s) => s.toggleMute);
  const Icon = muted || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;
  return (
    <div className={`volume ${className}`}>
      <button className="icon-btn" onClick={toggleMute} aria-label={muted ? "Unmute" : "Mute"}>
        <Icon size={16} />
      </button>
      <VolumeSlider />
    </div>
  );
}

function LCD() {
  const song = useCurrentSong();
  const setNowPlaying = useUI((s) => s.setNowPlaying);
  if (!song) {
    return (
      <div className="lcd empty" data-tauri-drag-region>
        <img src="/icon.svg" alt="" className="lcd-logo" draggable={false} />
      </div>
    );
  }
  return (
    <div className="lcd" onContextMenu={(e) => showMenu(e, songMenu([song]))}>
      <button className="lcd-art" onClick={() => setNowPlaying(true)} title="Open Now Playing">
        <Artwork id={song.coverArt} size={46} eager />
      </button>
      <div className="lcd-main">
        <div className="lcd-text" onDoubleClick={() => setNowPlaying(true)}>
          <div className="lcd-title">
            <span className="truncate">{song.title}</span>
            {isExplicit(song) && <ExplicitBadge />}
          </div>
          <div className="lcd-sub truncate">
            <button className="link" onClick={() => song.artistId && go(`/artist/${song.artistId}`)}>
              {songArtist(song)}
            </button>
            {song.album && (
              <>
                {" — "}
                <button className="link" onClick={() => song.albumId && go(`/album/${song.albumId}`)}>
                  {song.album}
                </button>
              </>
            )}
          </div>
        </div>
        <Scrubber variant="lcd" />
      </div>
      <button className="icon-btn lcd-more" aria-label="More" onClick={(e) => showMenu(e, songMenu([song]))}>
        <Ellipsis size={16} />
      </button>
    </div>
  );
}

export function TopBar() {
  const panel = useUI((s) => s.panel);
  const togglePanel = useUI((s) => s.togglePanel);
  return (
    <header className="topbar" data-tauri-drag-region>
      <Transport />
      <LCD />
      <div className="topbar-right" data-tauri-drag-region>
        <VolumeControl />
        <button className={`icon-btn panel-toggle${panel === "lyrics" ? " on" : ""}`} onClick={() => togglePanel("lyrics")} aria-label="Lyrics" title="Lyrics">
          <LyricsIcon size={19} />
        </button>
        <button className={`icon-btn panel-toggle${panel === "queue" ? " on" : ""}`} onClick={() => togglePanel("queue")} aria-label="Playing Next" title="Playing Next">
          <QueueIcon size={19} />
        </button>
      </div>
      {isWindows && <WindowControls />}
    </header>
  );
}
