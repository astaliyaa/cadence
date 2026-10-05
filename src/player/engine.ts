/**
 * Two <audio> elements: one playing, one preloading the next track. When the
 * active one ends, the standby is already buffered and starts immediately, which
 * keeps gaps between tracks to a few milliseconds.
 */

type Listener = () => void;

export interface EngineEvents {
  ended: Listener;
  play: Listener;
  pause: Listener;
  waiting: Listener;
  playing: Listener;
  duration: Listener;
  error: (code: number) => void;
  seeked: Listener;
}

export interface StreamOpts {
  /**
   * For streams the server can't serve as byte ranges (transcodes): the URL of the
   * same stream starting `t` whole seconds in, or null if the server can't do that.
   * The webview can't seek inside such streams and restarts them from 0 instead.
   */
  seekSrc?: (t: number) => string | null;
  /** Track length, for when playback runs from an offset stream. */
  duration?: number;
}

interface Stream extends StreamOpts {
  /** Where the loaded stream starts within the track, in seconds. */
  offset: number;
}

const NO_STREAM: Stream = { offset: 0 };

/** Whether `t` lies inside a real (non-empty) seekable range. */
function canSeek(el: HTMLAudioElement, t: number) {
  const r = el.seekable;
  for (let i = 0; i < r.length; i++) if (r.end(i) > r.start(i) && r.start(i) <= t && t <= r.end(i)) return true;
  return false;
}

class AudioEngine {
  private elA = this.create();
  private elB = this.create();
  private active = this.elA;
  private standby = this.elB;
  private standbyKey: string | null = null;
  private handlers: Partial<EngineEvents> = {};
  private streams = new Map<HTMLAudioElement, Stream>();
  private volume = 1;
  private gain = 1;
  activeKey: string | null = null;

  private create() {
    const el = new Audio();
    el.preload = "auto";
    el.crossOrigin = null;
    const on = <K extends keyof HTMLMediaElementEventMap>(type: K, fn: () => void) =>
      el.addEventListener(type, () => {
        if (el === this.active) fn();
      });
    on("ended", () => this.handlers.ended?.());
    on("play", () => this.handlers.play?.());
    on("pause", () => this.handlers.pause?.());
    on("waiting", () => this.handlers.waiting?.());
    on("playing", () => this.handlers.playing?.());
    on("durationchange", () => this.handlers.duration?.());
    on("seeked", () => this.handlers.seeked?.());
    on("error", () => {
      const code = el.error?.code ?? 0;
      // Clearing src on purpose fires a harmless "empty src" error.
      if (el.getAttribute("src")) this.handlers.error?.(code);
    });
    return el;
  }

  on(handlers: Partial<EngineEvents>) {
    this.handlers = { ...this.handlers, ...handlers };
  }

  private stream(el = this.active) {
    return this.streams.get(el) ?? NO_STREAM;
  }

  load(key: string, src: string, opts: { autoplay: boolean; startAt?: number } & StreamOpts) {
    const reuse = this.standbyKey === key && this.standby.getAttribute("src") === src;
    const previous = this.active;
    let start = opts.startAt ?? 0;
    if (reuse) {
      this.active = this.standby;
      this.standby = previous;
      this.standbyKey = null;
      previous.pause();
    } else {
      const stream: Stream = { offset: 0, seekSrc: opts.seekSrc, duration: opts.duration };
      // Resuming partway into a stream that can't seek: start the stream there.
      const from = Math.floor(start);
      const offsetSrc = from > 0 ? opts.seekSrc?.(from) : null;
      if (offsetSrc) {
        stream.offset = from;
        start = 0;
        src = offsetSrc;
      }
      this.streams.set(this.active, stream);
      this.active.setAttribute("src", src);
      this.active.load();
    }
    this.activeKey = key;
    this.applyVolume();
    const el = this.active;
    if (start > 0 || (reuse && el.currentTime > 0)) {
      const seek = () => {
        el.currentTime = start;
      };
      if (el.readyState >= 1) seek();
      else el.addEventListener("loadedmetadata", seek, { once: true });
    }
    if (opts.autoplay) this.play();
    this.handlers.duration?.();
  }

  preload(key: string, src: string, opts: StreamOpts = {}) {
    if (this.standbyKey === key) return;
    this.standbyKey = key;
    this.streams.set(this.standby, { offset: 0, ...opts });
    this.standby.setAttribute("src", src);
    this.standby.load();
  }

  clearPreload() {
    this.standbyKey = null;
    this.streams.delete(this.standby);
    this.standby.removeAttribute("src");
    this.standby.load();
  }

  stop() {
    this.active.pause();
    this.active.removeAttribute("src");
    this.active.load();
    this.streams.delete(this.active);
    this.activeKey = null;
    this.clearPreload();
  }

  play() {
    const p = this.active.play();
    p?.catch((e: DOMException) => {
      if (e.name !== "AbortError") this.handlers.pause?.();
    });
  }

  pause() {
    this.active.pause();
  }

  /** For debugging only. */
  get elements() {
    return { active: this.active, standby: this.standby, standbyKey: this.standbyKey };
  }

  get paused() {
    return this.active.paused;
  }

  get currentTime() {
    return this.stream().offset + (this.active.currentTime || 0);
  }

  set currentTime(t: number) {
    if (!Number.isFinite(t)) return;
    t = Math.max(0, t);
    const el = this.active;
    const stream = this.stream();
    const rel = t - stream.offset;
    if (stream.seekSrc && !canSeek(el, rel)) {
      const from = Math.floor(t);
      const src = stream.seekSrc(from);
      if (src) {
        this.restartAt(src, from);
        return;
      }
    }
    el.currentTime = Math.max(0, rel);
  }

  /** Swaps the active stream for one that starts `offset` seconds into the track. */
  private restartAt(src: string, offset: number) {
    const el = this.active;
    const resume = !el.paused;
    this.stream().offset = offset;
    el.setAttribute("src", src);
    el.load();
    if (resume) this.play();
    this.handlers.duration?.();
  }

  get duration() {
    const { offset, duration: known } = this.stream();
    // An offset stream only knows its own (remaining) length.
    if (offset > 0 && known) return known;
    const d = this.active.duration;
    return Number.isFinite(d) ? offset + d : 0;
  }

  get buffered(): number {
    const { offset } = this.stream();
    const b = this.active.buffered;
    const t = this.active.currentTime;
    for (let i = 0; i < b.length; i++) if (b.start(i) <= t && t <= b.end(i)) return offset + b.end(i);
    return 0;
  }

  setVolume(v: number) {
    this.volume = v;
    this.applyVolume();
  }

  setGain(g: number) {
    this.gain = g;
    this.applyVolume();
  }

  private applyVolume() {
    // Perceptual curve so the slider feels linear.
    const v = Math.min(1, Math.max(0, this.volume * this.volume * this.gain));
    this.elA.volume = v;
    this.elB.volume = v;
  }
}

export const engine = new AudioEngine();
