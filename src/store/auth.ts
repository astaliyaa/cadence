import { create } from "zustand";
import { Subsonic } from "../api/subsonic";
import type { Credentials } from "../api/types";

const KEY = "cadence.auth";

function load(): Credentials | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Credentials) : null;
  } catch {
    return null;
  }
}

interface AuthState {
  creds: Credentials | null;
  client: Subsonic | null;
  serverInfo: { type?: string; version?: string } | null;
  extensions: string[];
  signIn: (client: Subsonic, info: { type?: string; serverVersion?: string }) => void;
  signOut: () => void;
  setExtensions: (ext: string[]) => void;
}

const initial = load();

export const useAuth = create<AuthState>((set) => ({
  creds: initial,
  client: initial ? new Subsonic(initial) : null,
  serverInfo: null,
  extensions: [],
  signIn: (client, info) => {
    localStorage.setItem(KEY, JSON.stringify(client.creds));
    set({ creds: client.creds, client, serverInfo: { type: info.type, version: info.serverVersion } });
  },
  signOut: () => {
    localStorage.removeItem(KEY);
    set({ creds: null, client: null, serverInfo: null, extensions: [] });
  },
  setExtensions: (extensions) => set({ extensions }),
}));

/** The signed-in client. Only call from screens rendered behind the sign-in gate. */
export function api(): Subsonic {
  const c = useAuth.getState().client;
  if (!c) throw new Error("Not signed in");
  return c;
}
