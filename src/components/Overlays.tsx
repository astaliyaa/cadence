import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronRight } from "lucide-react";
import { useUI, type MenuItem } from "../store/ui";

function MenuList({ items, x, y, altX, onClose }: { items: MenuItem[]; x: number; y: number; altX?: number; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y, ready: false });
  const [open, setOpen] = useState<{ index: number; x: number; y: number; altX: number } | null>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const pad = 8;
    let nx = x;
    let ny = y;
    if (nx + r.width > window.innerWidth - pad) nx = altX !== undefined ? altX - r.width : window.innerWidth - r.width - pad;
    if (ny + r.height > window.innerHeight - pad) ny = Math.max(pad, window.innerHeight - r.height - pad);
    setPos({ x: Math.max(pad, nx), y: ny, ready: true });
  }, [x, y, altX]);

  return (
    <>
    <div
      ref={ref}
      className="menu"
      role="menu"
      style={{ left: pos.x, top: pos.y, visibility: pos.ready ? "visible" : "hidden" }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((item, i) =>
        item.separator ? (
          <div key={i} className="menu-sep" />
        ) : (
          <button
            key={i}
            role="menuitem"
            className={`menu-item${item.danger ? " danger" : ""}${open?.index === i ? " active" : ""}`}
            disabled={item.disabled}
            onMouseEnter={(e) => {
              clearTimeout(hoverTimer.current);
              if (item.submenu) {
                const r = e.currentTarget.getBoundingClientRect();
                hoverTimer.current = setTimeout(() => setOpen({ index: i, x: r.right - 4, y: r.top - 5, altX: r.left + 4 }), 120);
              } else {
                hoverTimer.current = setTimeout(() => setOpen(null), 150);
              }
            }}
            onClick={(e) => {
              if (item.submenu) {
                const r = e.currentTarget.getBoundingClientRect();
                setOpen({ index: i, x: r.right - 4, y: r.top - 5, altX: r.left + 4 });
                return;
              }
              onClose();
              item.onSelect?.();
            }}
          >
            <span className="menu-icon">{item.checked ? <Check size={14} /> : item.icon}</span>
            <span className="menu-label">{item.label}</span>
            {item.submenu && <ChevronRight size={14} className="menu-chevron" />}
          </button>
        ),
      )}
    </div>
    {open && items[open.index]?.submenu && (
      <MenuList key={open.index} items={items[open.index].submenu!} x={open.x} y={open.y} altX={open.altX} onClose={onClose} />
    )}
    </>
  );
}

export function ContextMenuHost() {
  const menu = useUI((s) => s.menu);
  const close = useUI((s) => s.closeMenu);
  useEffect(() => {
    if (!menu) return;
    const onDown = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest(".menu")) close();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    const onBlur = () => close();
    window.addEventListener("mousedown", onDown, true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("blur", onBlur);
    window.addEventListener("resize", onBlur);
    document.addEventListener("scroll", onBlur, true);
    return () => {
      window.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("resize", onBlur);
      document.removeEventListener("scroll", onBlur, true);
    };
  }, [menu, close]);
  if (!menu) return null;
  return createPortal(<MenuList key={`${menu.x},${menu.y}`} items={menu.items} x={menu.x} y={menu.y} onClose={close} />, document.body);
}

export function Toasts() {
  const toasts = useUI((s) => s.toasts);
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className="toast">
          {t.text}
        </div>
      ))}
    </div>
  );
}

export function Dialogs() {
  const prompt = useUI((s) => s.prompt);
  const confirm = useUI((s) => s.confirm);
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (prompt) {
      setValue(prompt.initial ?? "");
      setTimeout(() => inputRef.current?.select(), 30);
    }
  }, [prompt]);

  if (prompt) {
    const done = (v: string | null) => {
      useUI.setState({ prompt: null });
      prompt.resolve(v);
    };
    return (
      <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && done(null)}>
        <form
          className="dialog"
          onSubmit={(e) => {
            e.preventDefault();
            done(value);
          }}
          onKeyDown={(e) => e.key === "Escape" && done(null)}
        >
          <h3>{prompt.title}</h3>
          <input ref={inputRef} className="text-field" value={value} placeholder={prompt.placeholder} onChange={(e) => setValue(e.target.value)} autoFocus />
          <div className="dialog-actions">
            <button type="button" className="btn secondary" onClick={() => done(null)}>
              Cancel
            </button>
            <button type="submit" className="btn primary" disabled={!value.trim()}>
              {prompt.confirmLabel ?? "OK"}
            </button>
          </div>
        </form>
      </div>
    );
  }

  if (confirm) {
    const done = (ok: boolean) => {
      useUI.setState({ confirm: null });
      confirm.resolve(ok);
    };
    return (
      <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && done(false)}>
        <div className="dialog" onKeyDown={(e) => e.key === "Escape" && done(false)}>
          <h3>{confirm.title}</h3>
          {confirm.message && <p>{confirm.message}</p>}
          <div className="dialog-actions">
            <button className="btn secondary" onClick={() => done(false)} autoFocus>
              Cancel
            </button>
            <button className={`btn ${confirm.danger ? "danger" : "primary"}`} onClick={() => done(true)}>
              {confirm.confirmLabel ?? "OK"}
            </button>
          </div>
        </div>
      </div>
    );
  }
  return null;
}
