import { create } from "zustand";
import { persist } from "zustand/middleware";

export type ThemePref = "system" | "light" | "dark";
export type ArtworkQuality = "standard" | "high" | "original";

export interface MotionSettings {
  enabled: boolean;
  /** Use the music.apple.com web player token, refreshed automatically. */
  autoRefresh: boolean;
  teamId: string;
  keyId: string;
  privateKey: string;
  token: string;
  storefront: string;
}

export interface Settings {
  theme: ThemePref;
  accent: string;
  artworkQuality: ArtworkQuality;
  streamFormat: "raw" | "mp3" | "opus" | "aac";
  maxBitRate: number; // 0 = original
  soundCheck: boolean;
  scrobble: boolean;
  autoplay: boolean;
  lrclib: boolean;
  lyricsBlur: boolean;
  animatedBackground: boolean;
  motion: MotionSettings;
  set: (patch: Partial<Omit<Settings, "set" | "setMotion">>) => void;
  setMotion: (patch: Partial<MotionSettings>) => void;
}

export const ACCENTS = [
  { name: "Red", value: "#fa2d48" },
  { name: "Pink", value: "#ff375f" },
  { name: "Orange", value: "#ff9f0a" },
  { name: "Green", value: "#30d158" },
  { name: "Teal", value: "#40c8e0" },
  { name: "Blue", value: "#0a84ff" },
  { name: "Indigo", value: "#5e5ce6" },
  { name: "Purple", value: "#bf5af2" },
];

export const useSettings = create<Settings>()(
  persist(
    (set) => ({
      theme: "system",
      accent: ACCENTS[0].value,
      artworkQuality: "high",
      streamFormat: "raw",
      maxBitRate: 0,
      soundCheck: false,
      scrobble: true,
      autoplay: true,
      lrclib: true,
      lyricsBlur: true,
      animatedBackground: true,
      motion: { enabled: false, autoRefresh: false, teamId: "", keyId: "", privateKey: "", token: "", storefront: "us" },
      set: (patch) => set(patch),
      setMotion: (patch) => set((s) => ({ motion: { ...s.motion, ...patch } })),
    }),
    { name: "cadence.settings", version: 1 },
  ),
);
