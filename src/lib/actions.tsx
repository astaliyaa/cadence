import {
  Disc3,
  Heart,
  HeartOff,
  ListEnd,
  ListPlus,
  ListStart,
  Mic2,
  Play,
  Plus,
  Radio,
  Shuffle,
  Trash2,
  UserRound,
} from "lucide-react";
import type { Album, Artist, Playlist, Song } from "../api/types";
import { api, useAuth } from "../store/auth";
import { usePlayer, type PlaySource } from "../player/store";
import { useUI, promptText, confirmAction, type MenuItem } from "../store/ui";
import { useFavorites } from "../store/favorites";
import { queryClient } from "../api/queryClient";
import { go } from "./nav";

const ICON = 15;
const toast = (t: string) => useUI.getState().toast(t);

// ---- playback helpers -----------------------------------------------------

export async function playAlbum(id: string, opts: { shuffle?: boolean; start?: number; next?: boolean; later?: boolean } = {}) {
  const album = await queryClient.fetchQuery({ queryKey: ["album", id], queryFn: () => api().album(id) });
  const songs = album.song ?? [];
  const p = usePlayer.getState();
  if (opts.next) {
    p.playNext(songs);
    toast("Album will play next");
  } else if (opts.later) {
    p.addToQueue(songs);
    toast("Added album to Up Next");
  } else {
    p.playList(songs, opts.start ?? 0, { shuffle: opts.shuffle, source: { kind: "album", id, name: album.name } });
  }
}

export async function playPlaylist(id: string, opts: { shuffle?: boolean; next?: boolean; later?: boolean } = {}) {
  const pl = await queryClient.fetchQuery({ queryKey: ["playlist", id], queryFn: () => api().playlist(id) });
  const songs = pl.entry ?? [];
  const p = usePlayer.getState();
  if (opts.next) return p.playNext(songs), toast("Playlist will play next");
  if (opts.later) return p.addToQueue(songs), toast("Added playlist to Up Next");
  p.playList(songs, 0, { shuffle: opts.shuffle, source: { kind: "playlist", id, name: pl.name } });
}

export async function playArtist(artist: Artist, opts: { shuffle?: boolean } = {}) {
  const full = await queryClient.fetchQuery({ queryKey: ["artist", artist.id], queryFn: () => api().artist(artist.id) });
  const albums = full.album ?? [];
  const lists = await Promise.all(
    albums.map((a) => queryClient.fetchQuery({ queryKey: ["album", a.id], queryFn: () => api().album(a.id) })),
  );
  const songs = lists.flatMap((l) => l.song ?? []);
  usePlayer.getState().playList(songs, 0, {
    shuffle: opts.shuffle ?? true,
    source: { kind: "artist", id: artist.id, name: artist.name },
  });
}

export async function startRadio(song: Song) {
  try {
    let songs: Song[] = [];
    if (song.artistId) songs = await api().similarSongs(song.artistId, 60).catch(() => []);
    if (songs.length < 5) songs = songs.concat(await api().randomSongs(50, song.genre));
    const rest = songs.filter((s) => s.id !== song.id);
    usePlayer.getState().playList([song, ...rest], 0, { source: { kind: "radio", name: `${song.title} Station` } });
  } catch {
    toast("Couldn't start a station");
  }
}

export function playSongs(songs: Song[], start: number, source?: PlaySource) {
  usePlayer.getState().playList(songs, start, { source });
}

// ---- playlists --------------------------------------------------------------

export function canEdit(pl: Playlist) {
  const me = useAuth.getState().creds?.username;
  return !pl.readonly && (!pl.owner || !me || pl.owner === me);
}

export async function addToPlaylist(playlist: Playlist, songIds: string[]) {
  try {
    await api().updatePlaylist(playlist.id, { add: songIds });
    queryClient.invalidateQueries({ queryKey: ["playlist", playlist.id] });
    queryClient.invalidateQueries({ queryKey: ["playlists"] });
    toast(`Added to “${playlist.name}”`);
  } catch {
    toast("Couldn't add to playlist");
  }
}

export async function newPlaylist(songIds: string[] = []) {
  const name = await promptText({ title: "New Playlist", placeholder: "Playlist name", confirmLabel: "Create" });
  if (!name?.trim()) return;
  try {
    const pl = await api().createPlaylist(name.trim(), songIds);
    await queryClient.invalidateQueries({ queryKey: ["playlists"] });
    toast(songIds.length ? `Added to “${name.trim()}”` : `Created “${name.trim()}”`);
    if (pl?.id && !songIds.length) go(`/playlist/${pl.id}`);
  } catch {
    toast("Couldn't create playlist");
  }
}

export async function deletePlaylist(pl: Playlist) {
  const ok = await confirmAction({
    title: `Delete “${pl.name}”?`,
    message: "This removes the playlist from your Navidrome library. Songs stay in your library.",
    confirmLabel: "Delete",
    danger: true,
  });
  if (!ok) return;
  try {
    await api().deletePlaylist(pl.id);
    queryClient.invalidateQueries({ queryKey: ["playlists"] });
    go("/");
    toast("Playlist deleted");
  } catch {
    toast("Couldn't delete playlist");
  }
}

export async function renamePlaylist(pl: Playlist) {
  const name = await promptText({ title: "Rename Playlist", initial: pl.name, confirmLabel: "Rename" });
  if (!name?.trim() || name === pl.name) return;
  await api().updatePlaylist(pl.id, { name: name.trim() });
  queryClient.invalidateQueries({ queryKey: ["playlists"] });
  queryClient.invalidateQueries({ queryKey: ["playlist", pl.id] });
}

function playlistSubmenu(songIds: () => Promise<string[]> | string[]): MenuItem[] {
  const playlists = (queryClient.getQueryData<Playlist[]>(["playlists"]) ?? []).filter(canEdit);
  return [
    {
      label: "New Playlist…",
      icon: <Plus size={ICON} />,
      onSelect: async () => newPlaylist(await songIds()),
    },
    ...(playlists.length ? [{ separator: true } as MenuItem] : []),
    ...playlists.map((pl) => ({ label: pl.name, onSelect: async () => addToPlaylist(pl, await songIds()) })),
  ];
}

// ---- menus ------------------------------------------------------------------

export function songMenu(
  songs: Song[],
  ctx: { playlist?: Playlist; playlistIndex?: number; queueIndex?: number; hideAlbum?: boolean } = {},
): MenuItem[] {
  const song = songs[0];
  const single = songs.length === 1;
  const loved = single && (useFavorites.getState().overrides[song.id] ?? !!song.starred);
  const items: MenuItem[] = [
    { label: "Play Next", icon: <ListStart size={ICON} />, onSelect: () => (usePlayer.getState().playNext(songs), toast("Will play next")) },
    { label: "Play Later", icon: <ListEnd size={ICON} />, onSelect: () => (usePlayer.getState().addToQueue(songs), toast("Added to Up Next")) },
  ];
  if (single) items.push({ label: "Create Station", icon: <Radio size={ICON} />, onSelect: () => startRadio(song) });
  items.push({ separator: true });
  if (single)
    items.push({
      label: loved ? "Undo Favorite" : "Favorite",
      icon: loved ? <HeartOff size={ICON} /> : <Heart size={ICON} />,
      onSelect: () => useFavorites.getState().toggle("song", song.id, loved),
    });
  items.push({ label: "Add to Playlist", icon: <ListPlus size={ICON} />, submenu: playlistSubmenu(() => songs.map((s) => s.id)) });
  if (single) {
    items.push({ separator: true });
    if (song.albumId && !ctx.hideAlbum) items.push({ label: "Go to Album", icon: <Disc3 size={ICON} />, onSelect: () => go(`/album/${song.albumId}`) });
    if (song.artistId) items.push({ label: "Go to Artist", icon: <Mic2 size={ICON} />, onSelect: () => go(`/artist/${song.artistId}`) });
  }
  if (ctx.playlist && ctx.playlistIndex !== undefined && canEdit(ctx.playlist)) {
    const pl = ctx.playlist;
    const idx = ctx.playlistIndex;
    items.push({ separator: true });
    items.push({
      label: "Remove from Playlist",
      icon: <Trash2 size={ICON} />,
      danger: true,
      onSelect: async () => {
        await api().updatePlaylist(pl.id, { removeIndexes: [idx] });
        queryClient.invalidateQueries({ queryKey: ["playlist", pl.id] });
        queryClient.invalidateQueries({ queryKey: ["playlists"] });
      },
    });
  }
  if (ctx.queueIndex !== undefined) {
    const qi = ctx.queueIndex;
    items.push({ separator: true });
    items.push({ label: "Remove from Up Next", icon: <Trash2 size={ICON} />, danger: true, onSelect: () => usePlayer.getState().removeAt(qi) });
  }
  return items;
}

export function albumMenu(album: Album): MenuItem[] {
  const loved = useFavorites.getState().overrides[album.id] ?? !!album.starred;
  const ids = async () => (await queryClient.fetchQuery({ queryKey: ["album", album.id], queryFn: () => api().album(album.id) })).song?.map((s) => s.id) ?? [];
  return [
    { label: "Play", icon: <Play size={ICON} />, onSelect: () => playAlbum(album.id) },
    { label: "Shuffle", icon: <Shuffle size={ICON} />, onSelect: () => playAlbum(album.id, { shuffle: true }) },
    { separator: true },
    { label: "Play Next", icon: <ListStart size={ICON} />, onSelect: () => playAlbum(album.id, { next: true }) },
    { label: "Play Later", icon: <ListEnd size={ICON} />, onSelect: () => playAlbum(album.id, { later: true }) },
    { separator: true },
    {
      label: loved ? "Undo Favorite" : "Favorite",
      icon: loved ? <HeartOff size={ICON} /> : <Heart size={ICON} />,
      onSelect: () => useFavorites.getState().toggle("album", album.id, loved),
    },
    { label: "Add to Playlist", icon: <ListPlus size={ICON} />, submenu: playlistSubmenu(ids) },
    ...(album.artistId
      ? [{ separator: true } as MenuItem, { label: "Go to Artist", icon: <Mic2 size={ICON} />, onSelect: () => go(`/artist/${album.artistId}`) }]
      : []),
  ];
}

export function artistMenu(artist: Artist): MenuItem[] {
  const loved = useFavorites.getState().overrides[artist.id] ?? !!artist.starred;
  return [
    { label: "Shuffle", icon: <Shuffle size={ICON} />, onSelect: () => playArtist(artist) },
    { separator: true },
    {
      label: loved ? "Undo Favorite" : "Favorite",
      icon: loved ? <HeartOff size={ICON} /> : <Heart size={ICON} />,
      onSelect: () => useFavorites.getState().toggle("artist", artist.id, loved),
    },
    { label: "Go to Artist", icon: <UserRound size={ICON} />, onSelect: () => go(`/artist/${artist.id}`) },
  ];
}

export function playlistMenu(pl: Playlist): MenuItem[] {
  return [
    { label: "Play", icon: <Play size={ICON} />, onSelect: () => playPlaylist(pl.id) },
    { label: "Shuffle", icon: <Shuffle size={ICON} />, onSelect: () => playPlaylist(pl.id, { shuffle: true }) },
    { separator: true },
    { label: "Play Next", icon: <ListStart size={ICON} />, onSelect: () => playPlaylist(pl.id, { next: true }) },
    { label: "Play Later", icon: <ListEnd size={ICON} />, onSelect: () => playPlaylist(pl.id, { later: true }) },
    ...(!canEdit(pl)
      ? []
      : [
          { separator: true } as MenuItem,
          { label: "Rename…", onSelect: () => renamePlaylist(pl) },
          { label: "Delete Playlist…", icon: <Trash2 size={ICON} />, danger: true, onSelect: () => deletePlaylist(pl) },
        ]),
  ];
}
