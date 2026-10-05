import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Song } from "../api/types";
import { useLyrics, type LyricLine } from "./lyrics";
import { useFrame } from "../player/hooks";
import { usePlayer } from "../player/store";
import { useSettings } from "../store/settings";

interface Props {
  song: Song | undefined;
  variant: "panel" | "full";
}

const LEAD = 0.25; // highlight slightly early, like Apple Music
const GAP_DOTS = 4; // seconds of silence that earn a "•••" line

interface Line extends LyricLine {
  dots?: boolean;
  end?: number;
}

function prepare(lines: LyricLine[]): Line[] {
  const out: Line[] = [];
  if (lines.length && lines[0].time > GAP_DOTS) out.push({ time: 0, text: "", dots: true, end: lines[0].time });
  lines.forEach((l, i) => {
    const next = lines[i + 1];
    if (!l.text) {
      if (next && next.time - l.time >= GAP_DOTS) out.push({ ...l, dots: true, end: next.time });
      return;
    }
    out.push(l);
  });
  return out;
}

function findActive(lines: Line[], t: number) {
  let lo = 0;
  let hi = lines.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid].time <= t + LEAD) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}

function SyncedLyrics({ lines: raw, variant }: { lines: LyricLine[]; variant: Props["variant"] }) {
  const lines = useMemo(() => prepare(raw), [raw]);
  const seek = usePlayer((s) => s.seek);
  const play = usePlayer((s) => s.play);
  const blurOn = useSettings((s) => s.lyricsBlur) && variant === "full";
  const [active, setActive] = useState(-1);
  const activeRef = useRef(-1);
  const boxRef = useRef<HTMLDivElement>(null);
  const lineRefs = useRef<(HTMLDivElement | null)[]>([]);
  const last = useRef({ active: -1, base: 0 });
  // A clicked line stays highlighted until playback reaches it (the stream may
  // restart a fraction of a second early).
  const pinned = useRef<{ index: number; time: number } | null>(null);
  const userOffset = useRef(0);
  const userScrolling = useRef(false);
  const idleTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useFrame((t) => {
    let i = findActive(lines, t);
    const pin = pinned.current;
    if (pin) {
      if (t + LEAD >= pin.time || t < pin.time - 3) pinned.current = null;
      else i = pin.index;
    }
    if (i !== activeRef.current) {
      activeRef.current = i;
      setActive(i);
    }
    // Dots progress for instrumental breaks.
    const cur = lines[i];
    if (cur?.dots && cur.end) {
      const el = lineRefs.current[i];
      el?.style.setProperty("--dots", String(Math.min(1, Math.max(0, (t - cur.time) / (cur.end - cur.time)))));
    }
  });

  const topOf = (i: number) => lineRefs.current[i]?.offsetTop ?? 0;

  const layout = (animate = true) => {
    const box = boxRef.current;
    if (!box) return;
    const anchor = box.clientHeight * (variant === "full" ? 0.36 : 0.28);
    const active = activeRef.current;
    const base = anchor - topOf(Math.max(0, active)) + userOffset.current;
    // Apple Music's ripple: when the lyrics advance a line or two, lines further
    // down set off a little later, so they only ever spread apart. Every other
    // move (seeking, scrolling, going back) shifts all lines together, which
    // keeps them from running into each other.
    const advance = active - last.current.active;
    const ripple = animate && !userScrolling.current && advance >= 1 && advance <= 2 && base < last.current.base;
    last.current = { active, base };
    lineRefs.current.forEach((el, i) => {
      if (!el) return;
      const dist = i - active;
      // Delay only the movement (transform, the first of the five transitioned
      // properties in app.css), never colour, scale or the hover highlight.
      el.style.transitionDelay = ripple && dist > 0 ? `${Math.min(dist, 8) * 45}ms, 0s, 0s, 0s, 0s` : "0s";
      el.style.transitionDuration = animate ? "" : "0ms";
      el.style.transform = `translate3d(0, ${base}px, 0)`;
      if (blurOn) {
        const blur = userScrolling.current || dist === 0 ? 0 : Math.min(Math.abs(dist), 5) * 0.7;
        el.style.filter = blur ? `blur(${blur}px)` : "";
      } else el.style.filter = "";
    });
  };

  useLayoutEffect(() => {
    layout(false);
    const ro = new ResizeObserver(() => layout(false));
    if (boxRef.current) ro.observe(boxRef.current);
    // Line heights change once the web font finishes loading.
    document.fonts?.ready.then(() => layout(false));
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines, blurOn]);

  useLayoutEffect(() => {
    if (!userScrolling.current) layout(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  useEffect(() => () => clearTimeout(idleTimer.current), []);

  const onWheel = (e: React.WheelEvent) => {
    userScrolling.current = true;
    boxRef.current?.classList.add("scrolling");
    const total = topOf(lines.length - 1);
    const ta = topOf(Math.max(0, activeRef.current));
    userOffset.current = Math.min(ta, Math.max(ta - total, userOffset.current - e.deltaY));
    layout(false);
    clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => {
      userScrolling.current = false;
      userOffset.current = 0;
      boxRef.current?.classList.remove("scrolling");
      layout(true);
    }, 2500);
  };

  return (
    <div ref={boxRef} className={`lyrics synced ${variant}`} onWheel={onWheel}>
      <div className="lyrics-inner">
        {lines.map((l, i) => (
          <div
            key={i}
            ref={(el) => {
              lineRefs.current[i] = el;
            }}
            className={`lyric-line${i === active ? " active" : i < active ? " past" : ""}${l.dots ? " dots" : ""}`}
            onClick={() => {
              pinned.current = { index: i, time: l.time };
              seek(l.time);
              play();
              userScrolling.current = false;
              userOffset.current = 0;
              clearTimeout(idleTimer.current);
              boxRef.current?.classList.remove("scrolling");
              activeRef.current = i;
              setActive(i);
              layout(true);
            }}
          >
            {l.dots ? (
              <span className="lyric-dots" aria-label="Instrumental">
                <i />
                <i />
                <i />
              </span>
            ) : (
              l.text
            )}
          </div>
        ))}
        <div className="lyrics-pad" />
      </div>
    </div>
  );
}

export function LyricsView({ song, variant }: Props) {
  const { data, isLoading } = useLyrics(song);

  if (!song) return <div className={`lyrics-empty ${variant}`}>Nothing playing</div>;
  if (isLoading) return <div className={`lyrics-empty ${variant}`}>Loading lyrics…</div>;
  if (!data || !data.lines.some((l) => l.text)) return <div className={`lyrics-empty ${variant}`}>Lyrics aren't available for this song.</div>;

  if (!data.synced) {
    return (
      <div className={`lyrics plain ${variant}`}>
        {data.lines.map((l, i) => (
          <p key={i} className={l.text ? "" : "gap"}>
            {l.text || " "}
          </p>
        ))}
        <div className="lyrics-source">Lyrics from {data.source}</div>
      </div>
    );
  }
  return <SyncedLyrics key={song.id} lines={data.lines} variant={variant} />;
}
