import { create } from "zustand";
import type { ReactNode } from "react";

export type SidePanel = "lyrics" | "queue" | null;

export interface MenuItem {
  label?: string;
  icon?: ReactNode;
  onSelect?: () => void;
  submenu?: MenuItem[];
  danger?: boolean;
  disabled?: boolean;
  checked?: boolean;
  separator?: boolean;
}

interface Toast {
  id: number;
  text: string;
}

interface PromptState {
  title: string;
  placeholder?: string;
  initial?: string;
  confirmLabel?: string;
  resolve: (value: string | null) => void;
}

interface ConfirmState {
  title: string;
  message?: string;
  confirmLabel?: string;
  danger?: boolean;
  resolve: (ok: boolean) => void;
}

interface UIState {
  panel: SidePanel;
  nowPlayingOpen: boolean;
  menu: { x: number; y: number; items: MenuItem[] } | null;
  toasts: Toast[];
  prompt: PromptState | null;
  confirm: ConfirmState | null;
  vibrancy: boolean;
  togglePanel: (p: Exclude<SidePanel, null>) => void;
  setNowPlaying: (open: boolean) => void;
  openMenu: (x: number, y: number, items: MenuItem[]) => void;
  closeMenu: () => void;
  toast: (text: string) => void;
  setVibrancy: (v: boolean) => void;
}

let toastId = 0;

export const useUI = create<UIState>((set, get) => ({
  panel: (localStorage.getItem("cadence.panel") as SidePanel) || null,
  nowPlayingOpen: false,
  menu: null,
  toasts: [],
  prompt: null,
  confirm: null,
  vibrancy: false,
  togglePanel: (p) => {
    const next = get().panel === p ? null : p;
    localStorage.setItem("cadence.panel", next ?? "");
    set({ panel: next });
  },
  setNowPlaying: (open) => set({ nowPlayingOpen: open }),
  openMenu: (x, y, items) => set({ menu: { x, y, items } }),
  closeMenu: () => set({ menu: null }),
  toast: (text) => {
    const id = ++toastId;
    set((s) => ({ toasts: [...s.toasts.slice(-2), { id, text }] }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 2400);
  },
  setVibrancy: (vibrancy) => set({ vibrancy }),
}));

export function promptText(opts: Omit<PromptState, "resolve">): Promise<string | null> {
  return new Promise((resolve) => useUI.setState({ prompt: { ...opts, resolve } }));
}

export function confirmAction(opts: Omit<ConfirmState, "resolve">): Promise<boolean> {
  return new Promise((resolve) => useUI.setState({ confirm: { ...opts, resolve } }));
}

/** Opens a context menu at the pointer (or under the clicked button). */
export function showMenu(e: { clientX: number; clientY: number; preventDefault?: () => void; stopPropagation?: () => void; currentTarget?: EventTarget | null; type?: string }, items: MenuItem[]) {
  e.preventDefault?.();
  e.stopPropagation?.();
  let { clientX: x, clientY: y } = e;
  if (e.type === "click" && e.currentTarget instanceof HTMLElement) {
    const r = e.currentTarget.getBoundingClientRect();
    x = r.left;
    y = r.bottom + 4;
  }
  useUI.getState().openMenu(x, y, items);
}
