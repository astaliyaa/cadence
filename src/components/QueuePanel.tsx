import { useMemo, useState } from "react";
import { Infinity as InfinityIcon, Repeat, Repeat1, Shuffle, X } from "lucide-react";
import { usePlayer, type QueueItem } from "../player/store";
import { useSettings } from "../store/settings";
import { showMenu } from "../store/ui";
import { songMenu } from "../lib/actions";
import { formatTime, songArtist } from "../lib/format";
import { Artwork } from "./Artwork";
import { NowPlayingBars } from "./icons";

const LIMIT = 250;

function Row({ item, index, current, onDragStart, onDrop }: { item: QueueItem; index: number; current?: boolean; onDragStart?: (i: number) => void; onDrop?: (i: number) => void }) {
  const jumpTo = usePlayer((s) => s.jumpTo);
  const removeAt = usePlayer((s) => s.removeAt);
  const playing = usePlayer((s) => s.playing);
  const [over, setOver] = useState(false);
  const s = item.song;
  return (
    <div
      className={`queue-row${current ? " current" : ""}${over ? " drag-over" : ""}`}
      onDoubleClick={() => !current && jumpTo(index)}
      onContextMenu={(e) => showMenu(e, songMenu([s], { queueIndex: current ? undefined : index }))}
      draggable={!current && !!onDragStart}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", String(index));
        onDragStart?.(index);
      }}
      onDragOver={(e) => {
        if (!onDrop) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        onDrop?.(index);
      }}
    >
      <button className="queue-art" onClick={() => !current && jumpTo(index)} aria-label={`Play ${s.title}`}>
        <Artwork id={s.coverArt} size={40} />
        {current && (
          <span className="queue-art-overlay">
            <NowPlayingBars paused={!playing} />
          </span>
        )}
      </button>
      <div className="queue-text">
        <div className="truncate queue-title">{s.title}</div>
        <div className="truncate queue-sub">{songArtist(s)}</div>
      </div>
      <span className="queue-time">{formatTime(s.duration)}</span>
      {!current && (
        <button className="icon-btn queue-remove" onClick={() => removeAt(index)} aria-label="Remove">
          <X size={13} />
        </button>
      )}
    </div>
  );
}

export function QueuePanel() {
  const items = usePlayer((s) => s.items);
  const index = usePlayer((s) => s.index);
  const shuffle = usePlayer((s) => s.shuffle);
  const repeat = usePlayer((s) => s.repeat);
  const source = usePlayer((s) => s.source);
  const p = usePlayer.getState();
  const autoplay = useSettings((s) => s.autoplay);
  const setSettings = useSettings((s) => s.set);
  const [tab, setTab] = useState<"next" | "history">("next");
  const [dragFrom, setDragFrom] = useState<number | null>(null);

  const current = items[index];
  const pos = useMemo(() => new Map(items.map((it, i) => [it.key, i])), [items]);
  const upcoming = items.slice(index + 1);
  const userItems = upcoming.filter((i) => !i.auto);
  const autoItems = upcoming.filter((i) => i.auto);
  const history = items.slice(0, Math.max(0, index)).reverse();

  const drop = (to: number) => {
    if (dragFrom !== null) p.move(dragFrom, to);
    setDragFrom(null);
  };

  return (
    <div className="queue-panel">
      <div className="segmented small">
        <button className={tab === "next" ? "on" : ""} onClick={() => setTab("next")}>
          Playing Next
        </button>
        <button className={tab === "history" ? "on" : ""} onClick={() => setTab("history")}>
          History
        </button>
      </div>

      {tab === "next" ? (
        <div className="queue-scroll">
          {current && (
            <>
              <Row item={current} index={index} current />
              <div className="queue-modes">
                <button className={`pill-toggle${shuffle ? " on" : ""}`} onClick={p.toggleShuffle} title="Shuffle">
                  <Shuffle size={15} />
                </button>
                <button className={`pill-toggle${repeat !== "off" ? " on" : ""}`} onClick={p.cycleRepeat} title="Repeat">
                  {repeat === "one" ? <Repeat1 size={15} /> : <Repeat size={15} />}
                </button>
                <button className={`pill-toggle${autoplay ? " on" : ""}`} onClick={() => setSettings({ autoplay: !autoplay })} title="Autoplay">
                  <InfinityIcon size={17} />
                </button>
              </div>
            </>
          )}

          <div className="queue-heading">
            <div>
              <h4>Playing Next</h4>
              {source && <div className="queue-source truncate">From {source.name}</div>}
            </div>
            {userItems.length > 0 && (
              <button className="link small" onClick={p.clearUpNext}>
                Clear
              </button>
            )}
          </div>
          {userItems.length === 0 && <div className="queue-empty">{current ? "Nothing queued up." : "Play something to fill your queue."}</div>}
          {userItems.slice(0, LIMIT).map((item) => {
            return <Row key={item.key} item={item} index={pos.get(item.key)!} onDragStart={setDragFrom} onDrop={drop} />;
          })}
          {userItems.length > LIMIT && <div className="queue-empty">and {userItems.length - LIMIT} more…</div>}

          {autoplay && autoItems.length > 0 && (
            <>
              <div className="queue-heading">
                <div>
                  <h4>Autoplay</h4>
                  <div className="queue-source">Similar music</div>
                </div>
              </div>
              {autoItems.slice(0, LIMIT).map((item) => {
                return <Row key={item.key} item={item} index={pos.get(item.key)!} onDragStart={setDragFrom} onDrop={drop} />;
              })}
            </>
          )}
        </div>
      ) : (
        <div className="queue-scroll">
          {history.length === 0 && <div className="queue-empty">Songs you play will show up here.</div>}
          {history.slice(0, LIMIT).map((item) => (
            <Row key={item.key} item={item} index={pos.get(item.key)!} />
          ))}
        </div>
      )}
    </div>
  );
}
