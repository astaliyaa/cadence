import { useRef, useState } from "react";
import { usePlayer } from "../player/store";
import { useFrame } from "../player/hooks";
import { engine } from "../player/engine";
import { formatTime } from "../lib/format";

interface Props {
  variant: "lcd" | "full";
}

/** Progress bar that animates via rAF (no React re-render per frame) and supports drag-to-seek. */
export function Scrubber({ variant }: Props) {
  const duration = usePlayer((s) => s.duration);
  const hasTrack = usePlayer((s) => s.index >= 0 && s.items.length > 0);
  const seek = usePlayer((s) => s.seek);
  const trackRef = useRef<HTMLDivElement>(null);
  const fillRef = useRef<HTMLDivElement>(null);
  const bufRef = useRef<HTMLDivElement>(null);
  const elapsedRef = useRef<HTMLSpanElement>(null);
  const remainRef = useRef<HTMLSpanElement>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const dragRef = useRef<number | null>(null);

  const paint = (t: number) => {
    const d = engine.duration || duration;
    const shown = dragRef.current ?? t;
    const pct = d > 0 ? Math.min(1, shown / d) : 0;
    if (fillRef.current) fillRef.current.style.transform = `scaleX(${pct})`;
    if (bufRef.current) bufRef.current.style.transform = `scaleX(${d > 0 ? Math.min(1, engine.buffered / d) : 0})`;
    if (elapsedRef.current) elapsedRef.current.textContent = formatTime(shown);
    if (remainRef.current) remainRef.current.textContent = `-${formatTime(Math.max(0, d - shown))}`;
  };
  useFrame(paint);

  const posFromEvent = (clientX: number) => {
    const r = trackRef.current!.getBoundingClientRect();
    const d = engine.duration || duration;
    return Math.min(1, Math.max(0, (clientX - r.left) / r.width)) * d;
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (!hasTrack || !(engine.duration || duration)) return;
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const t = posFromEvent(e.clientX);
    dragRef.current = t;
    setDrag(t);
    paint(t);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (dragRef.current === null) return;
    const t = posFromEvent(e.clientX);
    dragRef.current = t;
    paint(t);
  };
  const onPointerUp = (e: React.PointerEvent) => {
    if (dragRef.current === null) return;
    const t = posFromEvent(e.clientX);
    dragRef.current = null;
    setDrag(null);
    seek(t);
  };

  return (
    <div className={`scrubber scrubber--${variant}${drag !== null ? " dragging" : ""}${hasTrack ? "" : " disabled"}`}>
      <div
        ref={trackRef}
        className="scrubber-hit"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div className="scrubber-track">
          <div ref={bufRef} className="scrubber-buffer" />
          <div ref={fillRef} className="scrubber-fill" />
        </div>
      </div>
      <div className="scrubber-times">
        <span ref={elapsedRef}>0:00</span>
        <span ref={remainRef}>-0:00</span>
      </div>
    </div>
  );
}

export function VolumeSlider({ className = "" }: { className?: string }) {
  const volume = usePlayer((s) => s.volume);
  const muted = usePlayer((s) => s.muted);
  const setVolume = usePlayer((s) => s.setVolume);
  const v = muted ? 0 : volume;
  return (
    <input
      type="range"
      className={`slider ${className}`}
      min={0}
      max={1}
      step={0.01}
      value={v}
      aria-label="Volume"
      style={{ "--pct": `${v * 100}%` } as React.CSSProperties}
      onChange={(e) => setVolume(Number(e.target.value))}
      onWheel={(e) => setVolume(v + (e.deltaY < 0 ? 0.05 : -0.05))}
    />
  );
}
