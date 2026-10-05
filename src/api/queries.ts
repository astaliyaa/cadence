import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { api, useAuth } from "../store/auth";
import type { AlbumListType } from "./types";

const PAGE = 120;

export function useAlbumList(type: AlbumListType, size = 30, extra: Record<string, string | number> = {}) {
  return useQuery({
    queryKey: ["albumList", type, size, extra],
    queryFn: () => api().albumList(type, size, 0, extra),
    staleTime: type === "random" ? Infinity : undefined,
  });
}

export function useInfiniteAlbums(type: AlbumListType, extra: Record<string, string | number> = {}) {
  return useInfiniteQuery({
    queryKey: ["albumsInfinite", type, extra],
    queryFn: ({ pageParam }) => api().albumList(type, PAGE, pageParam, extra),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => (last.length < PAGE ? undefined : pages.length * PAGE),
  });
}

export function useInfiniteSongs() {
  return useInfiniteQuery({
    queryKey: ["songsInfinite"],
    queryFn: async ({ pageParam }) =>
      (await api().search("", { artist: 0, album: 0, song: 300, songOffset: pageParam })).song ?? [],
    initialPageParam: 0,
    getNextPageParam: (last, pages) => (last.length < 300 ? undefined : pages.length * 300),
  });
}

export function useAlbum(id: string | undefined) {
  return useQuery({
    queryKey: ["album", id],
    queryFn: () => api().album(id!),
    enabled: !!id,
  });
}

export function useArtists() {
  return useQuery({ queryKey: ["artists"], queryFn: () => api().artists() });
}

export function useArtist(id: string | undefined) {
  return useQuery({ queryKey: ["artist", id], queryFn: () => api().artist(id!), enabled: !!id });
}

export function useArtistInfo(id: string | undefined) {
  return useQuery({
    queryKey: ["artistInfo", id],
    queryFn: () => api().artistInfo(id!),
    enabled: !!id,
    staleTime: 60 * 60_000,
    retry: 0,
  });
}

export function useTopSongs(name: string | undefined) {
  return useQuery({
    queryKey: ["topSongs", name],
    queryFn: () => api().topSongs(name!, 10),
    enabled: !!name,
    staleTime: 60 * 60_000,
    retry: 0,
  });
}

export function usePlaylists() {
  const signedIn = useAuth((s) => !!s.client);
  return useQuery({ queryKey: ["playlists"], queryFn: () => api().playlists(), enabled: signedIn });
}

export function usePlaylist(id: string | undefined) {
  return useQuery({ queryKey: ["playlist", id], queryFn: () => api().playlist(id!), enabled: !!id });
}

export function useGenres() {
  return useQuery({ queryKey: ["genres"], queryFn: () => api().genres() });
}

export function useStarred() {
  return useQuery({ queryKey: ["starred"], queryFn: () => api().starred() });
}

export function useSearch(query: string) {
  return useQuery({
    queryKey: ["search", query],
    queryFn: ({ signal }) => api().search(query, { artist: 12, album: 24, song: 40 }, signal),
    enabled: query.trim().length > 0,
    placeholderData: (prev) => prev,
  });
}
