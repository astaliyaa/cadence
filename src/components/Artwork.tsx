import { memo, useState } from "react";
import { Music, User } from "lucide-react";
import { useAuth } from "../store/auth";
import { useSettings, type ArtworkQuality } from "../store/settings";

// Fixed sizes so Navidrome's resized-image cache and the HTTP cache get reused.
const BUCKETS = [96, 160, 300, 450, 600, 900, 1200, 1600, 2400];

/**
 * Pixel size to request for artwork shown at `cssPx`. Navidrome re-encodes resized
 * covers (JPEG quality 75 by default), so "high" asks for twice the on-screen size
 * and lets the webview scale down, which stays sharp.
 */
export function artSize(cssPx: number, quality: ArtworkQuality = "high") {
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const want = cssPx * dpr * (quality === "standard" ? 1 : 2);
  return BUCKETS.find((b) => b >= want) ?? BUCKETS[BUCKETS.length - 1];
}

/**
 * Cover URL for artwork shown at `cssPx`. `large` marks hero-sized artwork (album
 * header, full-screen player), which loads the untouched original file when the
 * "original" quality setting is on.
 */
export function useCoverUrl(id: string | undefined, cssPx: number, large = false) {
  const client = useAuth((s) => s.client);
  const quality = useSettings((s) => s.artworkQuality) ?? "high";
  if (!id || !client) return undefined;
  if (large && quality === "original") return client.coverUrl(id);
  return client.coverUrl(id, artSize(cssPx, quality));
}

interface Props {
  id?: string;
  size: number;
  alt?: string;
  className?: string;
  round?: boolean;
  eager?: boolean;
  /** Hero-sized artwork; may load the full-resolution original. */
  large?: boolean;
  kind?: "album" | "artist";
}

export const Artwork = memo(function Artwork({ id, size, alt = "", className = "", round, eager, large, kind = "album" }: Props) {
  const src = useCoverUrl(id, size, large);
  const [loaded, setLoaded] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const showImg = src && failed !== src;
  const Fallback = kind === "artist" ? User : Music;
  return (
    <div className={`artwork${round ? " round" : ""} ${className}`}>
      {(!showImg || loaded !== src) && (
        <div className="artwork-placeholder">
          <Fallback size={Math.max(16, Math.min(64, size * 0.28))} strokeWidth={1.5} />
        </div>
      )}
      {showImg && (
        <img
          src={src}
          alt={alt}
          draggable={false}
          loading={eager ? "eager" : "lazy"}
          decoding="async"
          className={loaded === src ? "loaded" : ""}
          onLoad={() => setLoaded(src)}
          onError={() => setFailed(src)}
        />
      )}
    </div>
  );
});
