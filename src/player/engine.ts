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

class AudioEngine {
  private elA = this.create();
  private elB = this.create();
  private active = this.elA;
  private standby = this.elB;
  private standbyKey: string | null = null;
  private handlers: Partial<EngineEvents> = {};
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

  load(key: string, src: string, opts: { autoplay: boolean; startAt?: number }) {
    const reuse = this.standbyKey === key && this.standby.getAttribute("src") === src;
    const previous = this.active;
    if (reuse) {
      this.active = this.standby;
      this.standby = previous;
      this.standbyKey = null;
      previous.pause();
    } else {
      this.active.setAttribute("src", src);
      this.active.load();
    }
    this.activeKey = key;
    this.applyVolume();
    const el = this.active;
    const start = opts.startAt ?? 0;
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

  preload(key: string, src: string) {
    if (this.standbyKey === key) return;
    this.standbyKey = key;
    this.standby.setAttribute("src", src);
    this.standby.load();
  }

  clearPreload() {
    this.standbyKey = null;
    this.standby.removeAttribute("src");
    this.standby.load();
  }

  stop() {
    this.active.pause();
    this.active.removeAttribute("src");
    this.active.load();
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
    return this.active.currentTime || 0;
  }

  set currentTime(t: number) {
    if (Number.isFinite(t)) this.active.currentTime = Math.max(0, t);
  }

  get duration() {
    const d = this.active.duration;
    return Number.isFinite(d) ? d : 0;
  }

  get buffered(): number {
    const b = this.active.buffered;
    const t = this.active.currentTime;
    for (let i = 0; i < b.length; i++) if (b.start(i) <= t && t <= b.end(i)) return b.end(i);
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
