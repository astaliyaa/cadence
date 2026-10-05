import { useEffect, useState } from "react";
import { useAuth } from "../store/auth";

const cache = new Map<string, string>();

/** A saturated-but-dark tint sampled from the artwork, for card backgrounds. */
export function useArtworkTint(coverId: string | undefined, fallback = "rgb(60,60,66)") {
  const client = useAuth((s) => s.client);
  const [tint, setTint] = useState(() => (coverId && cache.get(coverId)) || fallback);

  useEffect(() => {
    if (!coverId || !client) return;
    const hit = cache.get(coverId);
    if (hit) return setTint(hit);
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.decoding = "async";
    img.onload = () => {
      try {
        const N = 20;
        const c = document.createElement("canvas");
        c.width = c.height = N;
        const ctx = c.getContext("2d", { willReadFrequently: true })!;
        ctx.drawImage(img, 0, 0, N, N);
        const d = ctx.getImageData(0, 0, N, N).data;
        // Bucket by hue and take the strongest bucket, so complementary colours
        // don't average out to grey.
        const buckets = Array.from({ length: 13 }, () => ({ r: 0, g: 0, b: 0, w: 0 }));
        for (let i = 0; i < d.length; i += 4) {
          const [pr, pg, pb] = [d[i], d[i + 1], d[i + 2]];
          const max = Math.max(pr, pg, pb);
          const min = Math.min(pr, pg, pb);
          const sat = max ? (max - min) / max : 0;
          const val = max / 255;
          let hue = 0;
          if (max !== min) {
            if (max === pr) hue = ((pg - pb) / (max - min) + 6) % 6;
            else if (max === pg) hue = (pb - pr) / (max - min) + 2;
            else hue = (pr - pg) / (max - min) + 4;
          }
          const idx = sat < 0.15 ? 12 : Math.floor(hue * 2) % 12;
          const w = idx === 12 ? 0.05 * val : sat * sat * (0.3 + val);
          const bk = buckets[idx];
          bk.r += pr * w;
          bk.g += pg * w;
          bk.b += pb * w;
          bk.w += w;
        }
        const best = buckets.reduce((a, b) => (b.w > a.w ? b : a));
        if (!best.w) return;
        const [r, g, b] = [best.r / best.w, best.g / best.w, best.b / best.w];
        // Keep it dark enough for white text.
        const lum = 0.299 * r + 0.587 * g + 0.114 * b;
        const k = lum > 96 ? 96 / lum : 1;
        const color = `rgb(${Math.round(r * k)}, ${Math.round(g * k)}, ${Math.round(b * k)})`;
        cache.set(coverId, color);
        setTint(color);
      } catch {
        /* tainted canvas: keep fallback */
      }
    };
    img.src = `${client.coverUrl(coverId, 160)}&cors=1`;
  }, [coverId, client]);

  return tint;
}
