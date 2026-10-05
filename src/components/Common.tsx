import type { ReactNode } from "react";
import { Shuffle } from "lucide-react";
import { PlayIcon } from "./icons";

export function PlayButtons({ onPlay, onShuffle, disabled }: { onPlay: () => void; onShuffle?: () => void; disabled?: boolean }) {
  return (
    <div className="play-buttons">
      <button className="btn accent" onClick={onPlay} disabled={disabled}>
        <PlayIcon size={14} /> Play
      </button>
      {onShuffle && (
        <button className="btn accent" onClick={onShuffle} disabled={disabled}>
          <Shuffle size={15} strokeWidth={2.4} /> Shuffle
        </button>
      )}
    </div>
  );
}

export function PageTitle({ children, actions }: { children: ReactNode; actions?: ReactNode }) {
  return (
    <div className="page-title-row">
      <h1 className="page-title">{children}</h1>
      {actions && <div className="page-title-actions">{actions}</div>}
    </div>
  );
}

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="segmented">
      {options.map((o) => (
        <button key={o.value} className={o.value === value ? "on" : ""} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="spinner-wrap">
      <div className="spinner" />
      {label && <span>{label}</span>}
    </div>
  );
}

export function Empty({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="empty-state">
      {icon && <div className="empty-icon">{icon}</div>}
      <h3>{title}</h3>
      {children && <p>{children}</p>}
    </div>
  );
}

export function ErrorState({ error, retry }: { error: unknown; retry?: () => void }) {
  return (
    <div className="empty-state">
      <h3>Something went wrong</h3>
      <p>{error instanceof Error ? error.message : String(error)}</p>
      {retry && (
        <button className="btn secondary" onClick={retry}>
          Try Again
        </button>
      )}
    </div>
  );
}
