import type { Album, Song } from "../api/types";

export function formatTime(sec: number | undefined) {
  if (!sec || !Number.isFinite(sec) || sec < 0) return "0:00";
  const s = Math.floor(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${r}` : `${m}:${r}`;
}

export function formatDurationLong(sec: number) {
  const mins = Math.round(sec / 60);
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"}`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h} hour${h === 1 ? "" : "s"}${m ? `, ${m} minute${m === 1 ? "" : "s"}` : ""}`;
}

export function plural(n: number, word: string) {
  return `${n.toLocaleString()} ${word}${n === 1 ? "" : "s"}`;
}

export function songArtist(song: Song) {
  return song.displayArtist || song.artist || song.artists?.map((a) => a.name).join(", ") || "Unknown Artist";
}

/** The album's artist for a song (not featured artists), falling back to the track artist. */
export function songAlbumArtist(song: Song) {
  return song.displayAlbumArtist || song.albumArtists?.map((a) => a.name).join(", ") || songArtist(song);
}

export function albumArtist(album: Album) {
  return album.displayArtist || album.artist || album.artists?.map((a) => a.name).join(", ") || "Unknown Artist";
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function releaseDateLabel(album: Album) {
  const d = album.releaseDate ?? album.originalReleaseDate;
  if (d?.year && d.month && d.day) return `${MONTHS[d.month - 1]} ${d.day}, ${d.year}`;
  if (d?.year) return String(d.year);
  return album.year ? String(album.year) : undefined;
}

export type QualityBadge = "Hi-Res Lossless" | "Lossless" | null;

const LOSSLESS = new Set(["flac", "alac", "wav", "aiff", "aif", "ape", "wv", "dsf", "dff"]);

export function qualityOf(song: Song | undefined): QualityBadge {
  if (!song) return null;
  const suffix = (song.suffix ?? "").toLowerCase();
  const lossless = LOSSLESS.has(suffix) || (suffix === "m4a" && (song.bitDepth ?? 0) > 0);
  if (!lossless) return null;
  if ((song.bitDepth ?? 0) > 16 || (song.samplingRate ?? 0) > 48000) return "Hi-Res Lossless";
  return "Lossless";
}

export function qualityDetail(song: Song) {
  const parts: string[] = [];
  if (song.bitDepth) parts.push(`${song.bitDepth}-bit`);
  if (song.samplingRate) parts.push(`${+(song.samplingRate / 1000).toFixed(1)} kHz`);
  if (!parts.length && song.bitRate) parts.push(`${song.bitRate} kbps`);
  if (song.suffix) parts.push(song.suffix.toUpperCase());
  return parts.join(" · ");
}

export function isExplicit(x: { explicitStatus?: string }) {
  return x.explicitStatus === "explicit" || x.explicitStatus === "e";
}

/** Deterministic pleasant gradient for genre tiles / placeholders. */
export function hashHue(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h) % 360;
}

export function stripHtml(html: string) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  return (doc.body.textContent ?? "").replace(/\s*Read more on Last\.fm.*$/i, "").trim();
}
