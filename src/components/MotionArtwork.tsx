import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSettings, type MotionSettings } from "../store/settings";
import { debugLog, invoke, isTauri, proxyUrl } from "../lib/platform";
import { Artwork } from "./Artwork";

const CACHE_KEY = "cadence.motion";
const HIT_TTL = 14 * 864e5;
const MISS_TTL = 3 * 864e5;

type CacheEntry = { u: string | null; t: number };

/** Bump when matching changes, so earlier "no motion artwork" results are retried. */
const MATCHER_VERSION = 3;

/** Results are only valid for the credentials (and matcher) that produced them. */
function signature(m: MotionSettings) {
  const creds = m.autoRefresh ? "auto" : [m.token.trim(), m.teamId.trim(), m.keyId.trim()].join("|");
  return `v${MATCHER_VERSION}|${creds}|${m.storefront.trim()}`;
}

/** What the native side needs to look up motion artwork. */
export function motionConfig(m: MotionSettings) {
  return {
    teamId: m.teamId,
    keyId: m.keyId,
    privateKey: m.privateKey,
    token: m.token,
    storefront: m.storefront,
    autoRefresh: !!m.autoRefresh,
  };
}

function readCache(sig: string): Record<string, CacheEntry> {
  try {
    const raw = JSON.parse(localStorage.getItem(CACHE_KEY) ?? "{}");
    return raw.sig === sig && raw.entries ? raw.entries : {};
  } catch {
    return {};
  }
}

function writeCache(sig: string, entries: Record<string, CacheEntry>) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ sig, entries }));
  } catch {
    /* quota */
  }
}

export function clearMotionCache() {
  localStorage.removeItem(CACHE_KEY);
}

export function motionConfigured(m: MotionSettings) {
  return m.enabled && isTauri && (!!m.autoRefresh || !!m.token.trim() || (!!m.teamId.trim() && !!m.keyId.trim() && !!m.privateKey.trim()));
}

/** HLS URL of the album's Apple Music motion artwork, if there is one. */
export function useMotionUrl(albumId: string | undefined, album: string | undefined, artist: string | undefined) {
  const motion = useSettings((s) => s.motion);
  const on = motionConfigured(motion);
  const sig = signature(motion);
  useEffect(() => {
    if (albumId) debugLog(`motion: artwork for "${album}" (enabled=${motion.enabled}, auto=${!!motion.autoRefresh}, configured=${on})`);
  }, [albumId, album, motion.enabled, motion.autoRefresh, on]);
  const { data } = useQuery({
    queryKey: ["motion", albumId, on, sig],
    enabled: on && !!albumId && !!album,
    staleTime: Infinity,
    retry: 0,
    queryFn: async () => {
      const hit = readCache(sig)[albumId!];
      if (hit && Date.now() - hit.t < (hit.u ? HIT_TTL : MISS_TTL)) {
        debugLog(`motion: cached ${hit.u ? `video ${hit.u}` : "no video"} for "${artist}" / "${album}"`);
        return hit.u;
      }
      debugLog(`motion: looking up "${artist}" — "${album}"`);
      let url: string | null;
      try {
        url = await invoke<string | null>("motion_artwork", {
          artist: artist ?? "",
          album: album!,
          config: motionConfig(motion),
        });
      } catch (e) {
        debugLog(`motion: lookup failed: ${e}`);
        throw e;
      }
      debugLog(`motion: ${url ? `video ${url}` : "no video"}`);
      const next = readCache(sig);
      next[albumId!] = { u: url, t: Date.now() };
      writeCache(sig, next);
      return url;
    },
  });
  return on ? data ?? null : null;
}

interface Props {
  albumId?: string;
  album?: string;
  artist?: string;
  coverId?: string;
  size: number;
  /** Hero-sized; the static fallback may load the full-resolution original. */
  large?: boolean;
  className?: string;
}

/** Static artwork that cross-fades into Apple Music motion artwork when available. */
export function MotionArtwork({ albumId, album, artist, coverId, size, large, className = "" }: Props) {
  const url = useMotionUrl(albumId, album, artist);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setReady(false);
    const video = videoRef.current;
    if (!url || !video) return;
    let destroyed = false;
    let hls: import("hls.js").default | null = null;

    (async () => {
      const { default: Hls } = await import("hls.js");
      if (destroyed) return;
      if (Hls.isSupported()) {
        hls = new Hls({
          capLevelToPlayerSize: true,
          maxBufferLength: 12,
          enableWorker: true,
          xhrSetup: (xhr, u) => {
            // Apple's CDN isn't CORS-friendly to our origin; go through the native proxy.
            if (isTauri) xhr.open("GET", proxyUrl(u), true);
          },
        });
        hls.loadSource(url);
        hls.attachMedia(video);
        hls.on(Hls.Events.MANIFEST_PARSED, (_e, data) => {
          debugLog(`motion: manifest ok, ${data.levels.length} level(s): ${data.levels.map((l) => `${l.width}x${l.height} ${l.videoCodec ?? "?"}`).join(", ")}`);
        });
        hls.on(Hls.Events.ERROR, (_e, data) => {
          debugLog(`motion: hls ${data.fatal ? "FATAL " : ""}${data.type}/${data.details}${data.response ? ` (HTTP ${data.response.code})` : ""}${data.error ? `: ${data.error.message}` : ""}`);
          if (data.fatal) hls?.destroy();
        });
      } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = url;
      }
      video.play().catch(() => {});
    })();

    return () => {
      destroyed = true;
      hls?.destroy();
      video.removeAttribute("src");
      video.load();
    };
  }, [url]);

  return (
    <div className={`motion-artwork ${className}${ready ? " is-playing" : ""}`}>
      <Artwork id={coverId} size={size} eager large={large} />
      {url && (
        <video
          ref={videoRef}
          muted
          loop
          playsInline
          autoPlay
          disablePictureInPicture
          onPlaying={() => {
            debugLog("motion: video playing");
            setReady(true);
          }}
          onError={(e) => debugLog(`motion: video element error ${e.currentTarget.error?.code}: ${e.currentTarget.error?.message ?? ""}`)}
          aria-hidden
        />
      )}
    </div>
  );
}
