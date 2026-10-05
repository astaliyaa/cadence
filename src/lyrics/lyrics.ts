import { useQuery } from "@tanstack/react-query";
import type { Song } from "../api/types";
import { api, useAuth } from "../store/auth";
import { useSettings } from "../store/settings";
import { proxyUrl } from "../lib/platform";
import { songArtist } from "../lib/format";

export interface LyricLine {
  time: number; // seconds; -1 for unsynced
  text: string;
}

export interface Lyrics {
  synced: boolean;
  lines: LyricLine[];
  source: string;
}

const LRC_LINE = /^\s*((?:\[\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?\])+)(.*)$/;
const LRC_TIME = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;

export function looksLikeLrc(text: string) {
  return /^\s*\[\d{1,3}:\d{1,2}([.:]\d{1,3})?\]/m.test(text);
}

export function parseLrc(text: string): LyricLine[] {
  const out: LyricLine[] = [];
  let offset = 0;
  for (const raw of text.split(/\r?\n/)) {
    const off = raw.match(/^\s*\[offset:\s*([+-]?\d+)\s*\]/i);
    if (off) {
      offset = Number(off[1]) / 1000;
      continue;
    }
    const m = raw.match(LRC_LINE);
    if (!m) continue;
    // Strip enhanced-LRC word timestamps like <00:12.34>.
    const value = m[2].replace(/<\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?>/g, "").trim();
    for (const t of m[1].matchAll(LRC_TIME)) {
      const frac = t[3] ? Number(t[3]) / Math.pow(10, t[3].length) : 0;
      out.push({ time: Math.max(0, Number(t[1]) * 60 + Number(t[2]) + frac - offset), text: value });
    }
  }
  return out.sort((a, b) => a.time - b.time);
}

function unsynced(text: string): LyricLine[] {
  return text.split(/\r?\n/).map((t) => ({ time: -1, text: t.trim() }));
}

interface LrclibRecord {
  syncedLyrics?: string | null;
  plainLyrics?: string | null;
  instrumental?: boolean;
  duration?: number;
}

async function lrclib(song: Song): Promise<LrclibRecord | null> {
  const artist = songArtist(song);
  const params = new URLSearchParams({ track_name: song.title, artist_name: artist });
  if (song.album) params.set("album_name", song.album);
  if (song.duration) params.set("duration", String(Math.round(song.duration)));
  const get = await fetch(proxyUrl(`https://lrclib.net/api/get?${params}`));
  if (get.ok) return (await get.json()) as LrclibRecord;

  const search = await fetch(proxyUrl(`https://lrclib.net/api/search?${new URLSearchParams({ track_name: song.title, artist_name: artist })}`));
  if (!search.ok) return null;
  const results = (await search.json()) as LrclibRecord[];
  const close = results.filter((r) => !song.duration || !r.duration || Math.abs(r.duration - song.duration) < 4);
  return close.find((r) => r.syncedLyrics) ?? close.find((r) => r.plainLyrics) ?? null;
}

async function fetchLyrics(song: Song): Promise<Lyrics | null> {
  const client = api();
  let plain: { text: string; source: string } | null = null;

  if (useAuth.getState().extensions.includes("songLyrics")) {
    try {
      const list = await client.lyricsBySongId(song.id);
      const synced = list.find((l) => l.synced && l.line?.length);
      if (synced) {
        const offset = (synced.offset ?? 0) / 1000;
        return {
          synced: true,
          source: "Navidrome",
          lines: synced.line!.map((l) => ({ time: Math.max(0, (l.start ?? 0) / 1000 - offset), text: l.value.trim() })),
        };
      }
      const flat = list.find((l) => l.line?.length);
      if (flat) plain = { text: flat.line!.map((l) => l.value).join("\n"), source: "Navidrome" };
    } catch {
      /* fall through */
    }
  }

  if (!plain) {
    try {
      const text = await client.lyrics(songArtist(song), song.title);
      if (text?.trim()) plain = { text, source: "Navidrome" };
    } catch {
      /* fall through */
    }
  }

  if (plain && looksLikeLrc(plain.text)) {
    const lines = parseLrc(plain.text);
    if (lines.length) return { synced: true, lines, source: plain.source };
  }

  if (useSettings.getState().lrclib) {
    try {
      const rec = await lrclib(song);
      if (rec?.syncedLyrics) return { synced: true, lines: parseLrc(rec.syncedLyrics), source: "LRCLIB" };
      if (!plain && rec?.plainLyrics) plain = { text: rec.plainLyrics, source: "LRCLIB" };
    } catch {
      /* offline or blocked */
    }
  }

  if (plain) return { synced: false, lines: unsynced(plain.text), source: plain.source };
  return null;
}

export function useLyrics(song: Song | undefined) {
  const lrclibOn = useSettings((s) => s.lrclib);
  return useQuery({
    queryKey: ["lyrics", song?.id, lrclibOn],
    queryFn: () => fetchLyrics(song!),
    enabled: !!song,
    staleTime: Infinity,
    gcTime: 60 * 60_000,
    retry: 0,
  });
}
