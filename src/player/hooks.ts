import { useEffect, useRef, useState } from "react";
import { usePlayer } from "./store";
import { engine } from "./engine";

export function useCurrentItem() {
  return usePlayer((s) => s.items[s.index]);
}

export function useCurrentSong() {
  return usePlayer((s) => s.items[s.index]?.song);
}

/** Current playback position, re-rendering at most `hz` times per second. */
export function usePosition(hz = 4) {
  const [t, setT] = useState(() => engine.currentTime);
  useEffect(() => {
    let last = -1;
    const id = setInterval(() => {
      const now = engine.currentTime;
      if (Math.abs(now - last) >= 0.05) {
        last = now;
        setT(now);
      }
    }, 1000 / hz);
    return () => clearInterval(id);
  }, [hz]);
  return t;
}

/**
 * Calls `fn(time)` every animation frame while playing (and once when paused/seeked)
 * without re-rendering — for progress bars and lyrics that need to be smooth.
 */
export function useFrame(fn: (t: number) => void) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    let raf = 0;
    let lastPaused = -1;
    const loop = () => {
      const t = engine.currentTime;
      if (!engine.paused || t !== lastPaused) {
        ref.current(t);
        lastPaused = engine.paused ? t : -1;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);
}
