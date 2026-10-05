import { create } from "zustand";
import { api } from "./auth";
import { useUI } from "./ui";
import { queryClient } from "../api/queryClient";

type Kind = "song" | "album" | "artist";

interface FavState {
  /** Local overrides on top of whatever `starred` the server last told us. */
  overrides: Record<string, boolean>;
  toggle: (kind: Kind, id: string, current: boolean) => Promise<void>;
}

export const useFavorites = create<FavState>((set) => ({
  overrides: {},
  toggle: async (kind, id, current) => {
    const next = !current;
    set((s) => ({ overrides: { ...s.overrides, [id]: next } }));
    try {
      await api().setStarred(kind, id, next);
      queryClient.invalidateQueries({ queryKey: ["starred"] });
    } catch {
      set((s) => ({ overrides: { ...s.overrides, [id]: current } }));
      useUI.getState().toast("Couldn't update Favorites");
    }
  },
}));

export function useIsLoved(id: string | undefined, serverStarred?: string | boolean) {
  const override = useFavorites((s) => (id ? s.overrides[id] : undefined));
  return override ?? !!serverStarred;
}
