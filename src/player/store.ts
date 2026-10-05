import { create } from "zustand";
import type { Song } from "../api/types";
import { api, useAuth } from "../store/auth";
import { useSettings } from "../store/settings";
import { useUI } from "../store/ui";
import { engine } from "./engine";
import { songArtist } from "../lib/format";
import { invokeQuiet } from "../lib/platform";

export interface QueueItem {
  key: string;
  song: Song;
  /** Added by Autoplay rather than by the user. */
  auto?: boolean;
}

export type Repeat = "off" | "all" | "one";

export interface PlaySource {
  kind: "album" | "playlist" | "artist" | "songs" | "search" | "genre" | "favorites" | "radio";
  id?: string;
  name: string;
}

interface PlayerState {
  items: QueueItem[];
  /** Play order before shuffle was turned on, so it can be restored. */
  original: QueueItem[] | null;
  index: number;
  playing: boolean;
  buffering: boolean;
  duration: number;
  shuffle: boolean;
  repeat: Repeat;
  volume: number;
  muted: boolean;
  source: PlaySource | null;

  playList: (songs: Song[], start?: number, opts?: { shuffle?: boolean; source?: PlaySource }) => void;
  playNext: (songs: Song[]) => void;
  addToQueue: (songs: Song[]) => void;
  jumpTo: (index: number) => void;
  removeAt: (index: number) => void;
  move: (from: number, to: number) => void;
  clearUpNext: () => void;
  togglePlay: () => void;
  play: () => void;
  pause: () => void;
  next: (auto?: boolean) => void;
  previous: () => void;
  seek: (t: number) => void;
  setVolume: (v: number) => void;
  toggleMute: () => void;
  toggleShuffle: () => void;
  cycleRepeat: () => void;
}

let keySeq = 0;
const mkItem = (song: Song, auto = false): QueueItem => ({ key: `${song.id}:${++keySeq}:${Date.now().toString(36)}`, song, auto });

function shuffled<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ---- persistence --------------------------------------------------------

const STORE_KEY = "cadence.player";
const POS_KEY = "cadence.position";

interface Saved {
  items: QueueItem[];
  original: QueueItem[] | null;
  index: number;
  shuffle: boolean;
  repeat: Repeat;
  volume: number;
  muted: boolean;
  source: PlaySource | null;
}

function loadSaved(): Partial<Saved> {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

const saved = loadSaved();

// ---- scrobble / session bookkeeping -------------------------------------

let listened = 0;
let lastTick = 0;
let scrobbled = false;
let startedAt = 0;
let nowPlayingSent = false;
let errorStreak = 0;
let fallbackFor: string | null = null;
let preloadedFor: string | null = null;
let autoplayLoading = false;

function streamSrc(song: Song, forceTranscode = false) {
  const s = useSettings.getState();
  if (forceTranscode) return api().streamUrl(song.id, { format: "mp3", maxBitRate: 320 });
  return api().streamUrl(song.id, { format: s.streamFormat, maxBitRate: s.maxBitRate });
}

function gainFor(song: Song, items: QueueItem[], index: number) {
  const s = useSettings.getState();
  if (!s.soundCheck || !song.replayGain) return 1;
  const rg = song.replayGain;
  // Use album gain when the neighbours are from the same album (album playback).
  const neighbour = items[index + 1]?.song ?? items[index - 1]?.song;
  const albumMode = !!neighbour && neighbour.albumId === song.albumId && rg.albumGain !== undefined;
  const db = (albumMode ? rg.albumGain : rg.trackGain) ?? rg.trackGain ?? 0;
  return Math.min(1, Math.pow(10, db / 20));
}

export const usePlayer = create<PlayerState>((set, get) => {
  const load = (autoplay: boolean, startAt = 0, forceTranscode = false) => {
    const { items, index } = get();
    const item = items[index];
    if (!item) return;
    listened = 0;
    lastTick = startAt;
    scrobbled = false;
    nowPlayingSent = false;
    startedAt = Math.floor(Date.now() / 1000);
    preloadedFor = null;
    if (!forceTranscode) fallbackFor = null;
    engine.setGain(gainFor(item.song, items, index));
    engine.load(item.key, streamSrc(item.song, forceTranscode), { autoplay, startAt });
    set({ duration: item.song.duration ?? 0, buffering: autoplay });
    pushMetadata(item.song);
  };

  const advance = async (auto: boolean) => {
    const { items, index, repeat } = get();
    if (auto && repeat === "one" && items[index]) {
      listened = 0;
      lastTick = 0;
      scrobbled = false;
      nowPlayingSent = false;
      startedAt = Math.floor(Date.now() / 1000);
      engine.currentTime = 0;
      engine.play();
      return;
    }
    if (index < items.length - 1) {
      set({ index: index + 1 });
      load(true);
      return;
    }
    if (repeat === "all" && items.length) {
      set({ index: 0 });
      load(true);
      return;
    }
    if (useSettings.getState().autoplay && items[index] && !autoplayLoading) {
      autoplayLoading = true;
      try {
        const more = await autoplaySongs(items[index].song, items);
        if (more.length) {
          set((s) => ({
            items: [...s.items, ...more.map((m) => mkItem(m, true))],
            original: s.original ? [...s.original, ...more.map((m) => mkItem(m, true))] : null,
            index: s.index + 1,
          }));
          load(true);
          return;
        }
      } finally {
        autoplayLoading = false;
      }
    }
    // End of the line.
    engine.pause();
    engine.currentTime = 0;
    set({ playing: false });
  };

  return {
    items: saved.items ?? [],
    original: saved.original ?? null,
    index: saved.index ?? -1,
    playing: false,
    buffering: false,
    duration: 0,
    shuffle: saved.shuffle ?? false,
    repeat: saved.repeat ?? "off",
    volume: saved.volume ?? 0.8,
    muted: saved.muted ?? false,
    source: saved.source ?? null,

    playList: (songs, start = 0, opts = {}) => {
      if (!songs.length) return;
      const ordered = songs.map((s) => mkItem(s));
      let items = ordered;
      let index = Math.min(Math.max(start, 0), songs.length - 1);
      // An explicit Shuffle press randomises everything; otherwise, if shuffle mode is
      // already on, the clicked song plays first and the rest is shuffled behind it.
      const explicit = opts.shuffle === true;
      const shuffle = opts.shuffle ?? get().shuffle;
      if (shuffle) {
        const first = explicit ? null : ordered[index];
        const rest = shuffled(first ? ordered.filter((i) => i !== first) : ordered);
        items = first ? [first, ...rest] : rest;
        index = 0;
      }
      set({ items, original: shuffle ? ordered : null, index, shuffle, source: opts.source ?? null });
      errorStreak = 0;
      load(true);
    },

    playNext: (songs) => {
      if (!songs.length) return;
      const { items, index, original } = get();
      if (index < 0 || !items.length) return get().playList(songs);
      const add = songs.map((s) => mkItem(s));
      const nextItems = [...items.slice(0, index + 1), ...add, ...items.slice(index + 1)];
      let nextOriginal = original;
      if (original) {
        const at = original.findIndex((i) => i.key === items[index].key);
        nextOriginal = [...original.slice(0, at + 1), ...add, ...original.slice(at + 1)];
      }
      set({ items: nextItems, original: nextOriginal });
      preloadedFor = null;
    },

    addToQueue: (songs) => {
      if (!songs.length) return;
      const { items, index } = get();
      if (index < 0 || !items.length) return get().playList(songs);
      const add = songs.map((s) => mkItem(s));
      // Keep user-added songs ahead of Autoplay suggestions.
      const firstAuto = items.findIndex((it, i) => i > index && it.auto);
      const at = firstAuto === -1 ? items.length : firstAuto;
      set((s) => ({
        items: [...s.items.slice(0, at), ...add, ...s.items.slice(at)],
        original: s.original ? [...s.original, ...add] : null,
      }));
      preloadedFor = null;
    },

    jumpTo: (i) => {
      if (i < 0 || i >= get().items.length) return;
      set({ index: i });
      load(true);
    },

    removeAt: (i) => {
      const { items, index, original } = get();
      const item = items[i];
      if (!item || i === index) return;
      set({
        items: items.filter((_, j) => j !== i),
        original: original ? original.filter((o) => o.key !== item.key) : null,
        index: i < index ? index - 1 : index,
      });
      preloadedFor = null;
    },

    move: (from, to) => {
      const { items, index } = get();
      if (from === to || from <= index || to <= index) return;
      const next = items.slice();
      const [it] = next.splice(from, 1);
      next.splice(to, 0, it);
      set({ items: next });
      preloadedFor = null;
    },

    clearUpNext: () => {
      const { items, index, original } = get();
      const keep = items.slice(0, index + 1);
      const keys = new Set(keep.map((k) => k.key));
      set({ items: keep, original: original ? original.filter((o) => keys.has(o.key)) : null });
      engine.clearPreload();
      preloadedFor = null;
    },

    togglePlay: () => {
      const { index, items } = get();
      if (index < 0 || !items[index]) return;
      if (!engine.activeKey) {
        load(true, Number(localStorage.getItem(POS_KEY)) || 0);
        return;
      }
      if (engine.paused) engine.play();
      else engine.pause();
    },
    play: () => {
      if (!engine.activeKey) return get().togglePlay();
      engine.play();
    },
    pause: () => engine.pause(),

    next: (auto = false) => {
      errorStreak = auto ? errorStreak : 0;
      void advance(auto);
    },

    previous: () => {
      const { index } = get();
      if (engine.currentTime > 3 || index <= 0) {
        engine.currentTime = 0;
        return;
      }
      set({ index: index - 1 });
      load(!engine.paused || get().playing);
    },

    seek: (t) => {
      engine.currentTime = t;
      lastTick = t;
      pushPlayback();
    },

    setVolume: (v) => {
      const volume = Math.min(1, Math.max(0, v));
      set({ volume, muted: false });
      engine.setVolume(volume);
    },
    toggleMute: () => {
      const muted = !get().muted;
      set({ muted });
      engine.setVolume(muted ? 0 : get().volume);
    },

    toggleShuffle: () => {
      const { shuffle, items, index, original } = get();
      if (!shuffle) {
        const head = items.slice(0, index + 1);
        const rest = shuffled(items.slice(index + 1));
        set({ shuffle: true, original: items, items: [...head, ...rest] });
      } else {
        const base = original ?? items;
        const current = items[index];
        const at = current ? base.findIndex((i) => i.key === current.key) : -1;
        set({ shuffle: false, original: null, items: base, index: at >= 0 ? at : index });
      }
      preloadedFor = null;
    },

    cycleRepeat: () => {
      const order: Repeat[] = ["off", "all", "one"];
      const r = get().repeat;
      set({ repeat: order[(order.indexOf(r) + 1) % 3] });
      preloadedFor = null;
    },
  };
});

async function autoplaySongs(seed: Song, items: QueueItem[]): Promise<Song[]> {
  const known = new Set(items.map((i) => i.song.id));
  let songs: Song[] = [];
  try {
    if (seed.artistId) songs = await api().similarSongs(seed.artistId, 40);
  } catch {
    /* Navidrome without an agent configured */
  }
  if (songs.length < 5) {
    try {
      songs = songs.concat(await api().randomSongs(40, songs.length ? undefined : seed.genre));
    } catch {
      /* ignore */
    }
  }
  const fresh = songs.filter((s) => !known.has(s.id));
  return shuffled(fresh).slice(0, 25);
}

// ---- engine wiring ------------------------------------------------------

export function currentSong(): Song | undefined {
  const { items, index } = usePlayer.getState();
  return items[index]?.song;
}

function pushMetadata(song: Song) {
  const cover = api().coverUrl(song.coverArt, 512);
  invokeQuiet("media_set_metadata", {
    title: song.title,
    artist: songArtist(song),
    album: song.album ?? "",
    coverUrl: cover,
    duration: song.duration,
  });
  if (!("mediaSession" in navigator) || "__TAURI_INTERNALS__" in window) return;
  navigator.mediaSession.metadata = new MediaMetadata({
    title: song.title,
    artist: songArtist(song),
    album: song.album ?? "",
    artwork: cover ? [{ src: cover, sizes: "512x512" }] : [],
  });
}

function pushPlayback() {
  const { playing, index } = usePlayer.getState();
  invokeQuiet("media_set_playback", {
    status: index < 0 ? "stopped" : playing ? "playing" : "paused",
    position: engine.currentTime,
  });
}

let posTimer = 0;

engine.on({
  play: () => {
    usePlayer.setState({ playing: true });
    pushPlayback();
    const song = currentSong();
    if (song && !nowPlayingSent && useSettings.getState().scrobble) {
      nowPlayingSent = true;
      api().scrobble(song.id, false).catch(() => {});
    }
  },
  pause: () => {
    usePlayer.setState({ playing: false, buffering: false });
    pushPlayback();
    localStorage.setItem(POS_KEY, String(engine.currentTime));
  },
  waiting: () => usePlayer.setState({ buffering: true }),
  playing: () => {
    usePlayer.setState({ buffering: false });
    errorStreak = 0;
  },
  seeked: () => pushPlayback(),
  duration: () => {
    const d = engine.duration;
    if (d > 0) usePlayer.setState({ duration: d });
  },
  ended: () => usePlayer.getState().next(true),
  error: (code) => {
    const song = currentSong();
    if (!song) return;
    // Codec the webview can't decode (e.g. ALAC): retry once as a transcoded stream.
    if (code === 4 && fallbackFor !== song.id) {
      fallbackFor = song.id;
      const { items, index } = usePlayer.getState();
      const key = items[index].key;
      engine.setGain(gainFor(song, items, index));
      engine.load(key, streamSrc(song, true), { autoplay: true, startAt: 0 });
      return;
    }
    errorStreak++;
    useUI.getState().toast(`Couldn't play “${song.title}”`);
    usePlayer.setState({ playing: false, buffering: false });
    if (errorStreak < 3) setTimeout(() => usePlayer.getState().next(true), 800);
  },
});

// Progress-driven bookkeeping: scrobbling, preloading the next track, saving position.
setInterval(() => {
  const st = usePlayer.getState();
  if (!st.playing) return;
  const t = engine.currentTime;
  const delta = t - lastTick;
  if (delta > 0 && delta < 2) listened += delta;
  lastTick = t;

  const song = st.items[st.index]?.song;
  if (!song) return;
  const duration = engine.duration || song.duration || 0;

  if (!scrobbled && duration > 0 && listened >= Math.min(240, duration / 2) && useSettings.getState().scrobble) {
    scrobbled = true;
    api()
      .scrobble(song.id, true, startedAt * 1000)
      .catch(() => {});
  }

  const nextIdx = st.repeat === "one" ? -1 : st.index + 1 < st.items.length ? st.index + 1 : st.repeat === "all" ? 0 : -1;
  const next = st.items[nextIdx];
  if (next && duration - t < 40 && preloadedFor !== next.key) {
    preloadedFor = next.key;
    engine.preload(next.key, streamSrc(next.song));
  }

  if (++posTimer % 10 === 0) localStorage.setItem(POS_KEY, String(t));
}, 500);

// Persist queue state (cheap: only on queue-shaped changes).
let saveTimer: ReturnType<typeof setTimeout> | undefined;
usePlayer.subscribe((s, prev) => {
  if (
    s.items === prev.items &&
    s.index === prev.index &&
    s.shuffle === prev.shuffle &&
    s.repeat === prev.repeat &&
    s.volume === prev.volume &&
    s.muted === prev.muted &&
    s.source === prev.source
  )
    return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const MAX = 1500;
    const start = Math.max(0, s.index - 200);
    const data: Saved = {
      items: s.items.slice(start, start + MAX),
      original: s.original ? s.original.slice(0, MAX) : null,
      index: s.index - start,
      shuffle: s.shuffle,
      repeat: s.repeat,
      volume: s.volume,
      muted: s.muted,
      source: s.source,
    };
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(data));
    } catch {
      /* quota */
    }
  }, 400);
});

window.addEventListener("beforeunload", () => localStorage.setItem(POS_KEY, String(engine.currentTime)));

if (import.meta.env.DEV) Object.assign(window, { __cadence: { engine, usePlayer } });

let mediaHooked = false;

/** Called after sign-in: restore last session (paused) and hook up OS media keys. */
export async function initPlayer() {
  const st = usePlayer.getState();
  engine.setVolume(st.muted ? 0 : st.volume);
  const item = st.items[st.index];
  if (item && useAuth.getState().client && !engine.activeKey) {
    const pos = Number(localStorage.getItem(POS_KEY)) || 0;
    engine.setGain(gainFor(item.song, st.items, st.index));
    engine.load(item.key, streamSrc(item.song), { autoplay: false, startAt: pos });
    lastTick = pos;
    usePlayer.setState({ duration: item.song.duration ?? 0 });
    pushMetadata(item.song);
    pushPlayback();
  }

  if (mediaHooked) return;
  mediaHooked = true;
  if ("__TAURI_INTERNALS__" in window) {
    const { listen } = await import("@tauri-apps/api/event");
    await listen<{ kind: string; value?: number }>("media-control", ({ payload }) => {
      const p = usePlayer.getState();
      switch (payload.kind) {
        case "play":
          p.play();
          break;
        case "pause":
          p.pause();
          break;
        case "toggle":
          p.togglePlay();
          break;
        case "next":
          p.next();
          break;
        case "previous":
          p.previous();
          break;
        case "stop":
          p.pause();
          break;
        case "seek":
          if (payload.value !== undefined) p.seek(payload.value);
          break;
        case "seekBy":
          if (payload.value !== undefined) p.seek(engine.currentTime + payload.value);
          break;
        case "volume":
          if (payload.value !== undefined) p.setVolume(Math.sqrt(payload.value));
          break;
      }
    });
  } else if ("mediaSession" in navigator) {
    const ms = navigator.mediaSession;
    const p = () => usePlayer.getState();
    ms.setActionHandler("play", () => p().play());
    ms.setActionHandler("pause", () => p().pause());
    ms.setActionHandler("nexttrack", () => p().next());
    ms.setActionHandler("previoustrack", () => p().previous());
    ms.setActionHandler("seekto", (d) => d.seekTime !== undefined && p().seek(d.seekTime));
  }
}
