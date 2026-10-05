// Filled transport glyphs in the spirit of SF Symbols (play.fill, forward.fill, …).
import type { SVGProps } from "react";

type P = SVGProps<SVGSVGElement> & { size?: number };

const base = ({ size = 20, ...rest }: P) => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "currentColor",
  "aria-hidden": true,
  ...rest,
});

export const PlayIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M7.2 4.6c0-1.2 1.3-1.9 2.3-1.3l11 6.9c1 .6 1 2 0 2.6l-11 6.9c-1 .6-2.3-.1-2.3-1.3z" />
  </svg>
);

export const PauseIcon = (p: P) => (
  <svg {...base(p)}>
    <rect x="5.5" y="3.5" width="4.6" height="17" rx="1.4" />
    <rect x="13.9" y="3.5" width="4.6" height="17" rx="1.4" />
  </svg>
);

export const ForwardIcon = (p: P) => (
  <svg {...base(p)} viewBox="0 0 28 24">
    <path d="M2.5 6.2c0-1 1.1-1.6 1.9-1.1l8.6 5.8c.8.5.8 1.7 0 2.2l-8.6 5.8c-.8.5-1.9-.1-1.9-1.1z" />
    <path d="M13.5 6.2c0-1 1.1-1.6 1.9-1.1l8.6 5.8c.8.5.8 1.7 0 2.2l-8.6 5.8c-.8.5-1.9-.1-1.9-1.1z" />
  </svg>
);

export const BackwardIcon = (p: P) => (
  <svg {...base(p)} viewBox="0 0 28 24">
    <path d="M25.5 6.2c0-1-1.1-1.6-1.9-1.1L15 10.9c-.8.5-.8 1.7 0 2.2l8.6 5.8c.8.5 1.9-.1 1.9-1.1z" />
    <path d="M14.5 6.2c0-1-1.1-1.6-1.9-1.1L4 10.9c-.8.5-.8 1.7 0 2.2l8.6 5.8c.8.5 1.9-.1 1.9-1.1z" />
  </svg>
);

export const LyricsIcon = (p: P) => (
  <svg {...base(p)} fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
    <path d="M4.5 5.5h15a1.5 1.5 0 0 1 1.5 1.5v9a1.5 1.5 0 0 1-1.5 1.5H10l-4.2 3.1c-.4.3-.8 0-.8-.4V17.5h-.5A1.5 1.5 0 0 1 3 16V7a1.5 1.5 0 0 1 1.5-1.5Z" />
    <path d="M8.7 10.2c0-.8.6-1.4 1.4-1.4M8.7 10.2v2.4M13.2 10.2c0-.8.6-1.4 1.4-1.4M13.2 10.2v2.4" />
  </svg>
);

export const QueueIcon = (p: P) => (
  <svg {...base(p)} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round">
    <path d="M9 6.5h11M9 12h11M9 17.5h11" />
    <circle cx="4.6" cy="6.5" r="1.1" fill="currentColor" stroke="none" />
    <circle cx="4.6" cy="12" r="1.1" fill="currentColor" stroke="none" />
    <circle cx="4.6" cy="17.5" r="1.1" fill="currentColor" stroke="none" />
  </svg>
);

export const ExplicitBadge = () => (
  <span className="badge-explicit" title="Explicit" aria-label="Explicit">
    E
  </span>
);

export const LosslessIcon = (p: P) => (
  <svg {...base(p)} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
    <path d="M3 12h1.5M7 8v8M10.5 5v14M14 9v6M17.5 7v10M21 11v2" />
  </svg>
);

/** Animated equaliser bars shown next to the playing track. */
export const NowPlayingBars = ({ paused }: { paused?: boolean }) => (
  <span className={`np-bars${paused ? " paused" : ""}`} aria-label="Now playing">
    <i />
    <i />
    <i />
    <i />
  </span>
);
