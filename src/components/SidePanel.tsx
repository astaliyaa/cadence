import { useUI } from "../store/ui";
import { useCurrentSong } from "../player/hooks";
import { LyricsView } from "../lyrics/LyricsView";
import { AmbientBackground } from "./AmbientBackground";
import { QueuePanel } from "./QueuePanel";

export function SidePanel() {
  const panel = useUI((s) => s.panel);
  const npOpen = useUI((s) => s.nowPlayingOpen);
  const song = useCurrentSong();
  if (!panel) return null;
  return (
    <aside className={`side-panel ${panel}`}>
      {panel === "lyrics" ? (
        <div className="side-lyrics">
          <AmbientBackground coverId={song?.coverArt} paused={npOpen} still />
          <LyricsView song={song} variant="panel" />
        </div>
      ) : (
        <QueuePanel />
      )}
    </aside>
  );
}
