import SparkMD5 from "spark-md5";
import type {
  Album,
  AlbumListType,
  AlbumWithSongs,
  Artist,
  ArtistInfo,
  ArtistWithAlbums,
  Credentials,
  Genre,
  Playlist,
  PlaylistWithSongs,
  SearchResult,
  Song,
  Starred,
  StructuredLyrics,
} from "./types";

const CLIENT_NAME = "Cadence";
const API_VERSION = "1.16.1";

export class SubsonicError extends Error {
  constructor(
    message: string,
    public code?: number,
  ) {
    super(message);
  }
}

type Params = Record<string, string | number | boolean | undefined | (string | number)[]>;

function randomSalt() {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function normalizeServerUrl(input: string) {
  let url = input.trim();
  if (!/^https?:\/\//i.test(url)) url = `http://${url}`;
  return url.replace(/\/+$/, "");
}

export class Subsonic {
  readonly base: string;
  private auth: string;

  constructor(public creds: Credentials) {
    this.base = creds.server;
    // The salt is fixed per sign-in so cover/stream URLs stay stable and cacheable.
    this.auth = new URLSearchParams({
      u: creds.username,
      t: creds.token,
      s: creds.salt,
      v: API_VERSION,
      c: CLIENT_NAME,
    }).toString();
  }

  static async signIn(server: string, username: string, password: string) {
    const salt = randomSalt();
    const creds: Credentials = {
      server: normalizeServerUrl(server),
      username: username.trim(),
      salt,
      token: SparkMD5.hash(password + salt),
    };
    const client = new Subsonic(creds);
    const res = await client.get<{ type?: string; serverVersion?: string; openSubsonic?: boolean }>("ping");
    return { client, server: res };
  }

  url(endpoint: string, params: Params = {}) {
    const qs = new URLSearchParams(this.auth);
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined || v === "") continue;
      if (Array.isArray(v)) v.forEach((x) => qs.append(k, String(x)));
      else qs.append(k, String(v));
    }
    return `${this.base}/rest/${endpoint}?${qs.toString()}`;
  }

  async get<T = Record<string, unknown>>(endpoint: string, params: Params = {}, signal?: AbortSignal): Promise<T> {
    let res: Response;
    try {
      res = await fetch(this.url(endpoint, { ...params, f: "json" }), { signal });
    } catch (e) {
      if ((e as Error).name === "AbortError") throw e;
      throw new SubsonicError(`Can't reach ${this.base}. Check the address and your connection.`);
    }
    if (!res.ok) throw new SubsonicError(`Server responded with ${res.status}`, res.status);
    const json = await res.json().catch(() => null);
    const body = json?.["subsonic-response"];
    if (!body) throw new SubsonicError("That doesn't look like a Navidrome/Subsonic server.");
    if (body.status !== "ok") {
      throw new SubsonicError(body.error?.message ?? "Request failed", body.error?.code);
    }
    return body as T;
  }

  // ---- media URLs -------------------------------------------------------

  coverUrl(id: string | undefined, size?: number) {
    if (!id) return undefined;
    return this.url("getCoverArt", { id, size });
  }

  streamUrl(id: string, opts: { format?: string; maxBitRate?: number } = {}) {
    const format = opts.format && opts.format !== "raw" ? opts.format : undefined;
    const transcoding = !!format || !!opts.maxBitRate;
    return this.url("stream", {
      id,
      format: format ?? (transcoding ? undefined : "raw"),
      maxBitRate: opts.maxBitRate || undefined,
      // Lets the webview seek inside transcoded streams.
      estimateContentLength: transcoding ? true : undefined,
    });
  }

  // ---- system -----------------------------------------------------------

  async extensions(): Promise<string[]> {
    try {
      const r = await this.get<{ openSubsonicExtensions?: { name: string }[] }>("getOpenSubsonicExtensions");
      return (r.openSubsonicExtensions ?? []).map((e) => e.name);
    } catch {
      return [];
    }
  }

  // ---- browsing ---------------------------------------------------------

  async albumList(type: AlbumListType, size = 40, offset = 0, extra: Params = {}): Promise<Album[]> {
    const r = await this.get<{ albumList2?: { album?: Album[] } }>("getAlbumList2", { type, size, offset, ...extra });
    return r.albumList2?.album ?? [];
  }

  async album(id: string): Promise<AlbumWithSongs> {
    const r = await this.get<{ album: AlbumWithSongs }>("getAlbum", { id });
    return r.album;
  }

  async artists(): Promise<Artist[]> {
    const r = await this.get<{ artists?: { index?: { name: string; artist?: Artist[] }[] } }>("getArtists");
    return (r.artists?.index ?? []).flatMap((i) => i.artist ?? []);
  }

  async artist(id: string): Promise<ArtistWithAlbums> {
    const r = await this.get<{ artist: ArtistWithAlbums }>("getArtist", { id });
    return r.artist;
  }

  async artistInfo(id: string): Promise<ArtistInfo> {
    const r = await this.get<{ artistInfo2?: ArtistInfo }>("getArtistInfo2", { id, count: 12 });
    return r.artistInfo2 ?? {};
  }

  async topSongs(artist: string, count = 10): Promise<Song[]> {
    const r = await this.get<{ topSongs?: { song?: Song[] } }>("getTopSongs", { artist, count });
    return r.topSongs?.song ?? [];
  }

  async similarSongs(id: string, count = 50): Promise<Song[]> {
    const r = await this.get<{ similarSongs2?: { song?: Song[] } }>("getSimilarSongs2", { id, count });
    return r.similarSongs2?.song ?? [];
  }

  async randomSongs(size = 50, genre?: string): Promise<Song[]> {
    const r = await this.get<{ randomSongs?: { song?: Song[] } }>("getRandomSongs", { size, genre });
    return r.randomSongs?.song ?? [];
  }

  async song(id: string): Promise<Song> {
    const r = await this.get<{ song: Song }>("getSong", { id });
    return r.song;
  }

  async genres(): Promise<Genre[]> {
    const r = await this.get<{ genres?: { genre?: Genre[] } }>("getGenres");
    return r.genres?.genre ?? [];
  }

  async starred(): Promise<Starred> {
    const r = await this.get<{ starred2?: Starred }>("getStarred2");
    return r.starred2 ?? {};
  }

  async search(
    query: string,
    counts: { artist?: number; album?: number; song?: number; songOffset?: number } = {},
    signal?: AbortSignal,
  ): Promise<SearchResult> {
    const r = await this.get<{ searchResult3?: SearchResult }>(
      "search3",
      {
        // `""` is Navidrome's "match everything" (used to page through the whole library).
        query: query.trim() || '""',
        artistCount: counts.artist ?? 12,
        albumCount: counts.album ?? 18,
        songCount: counts.song ?? 30,
        songOffset: counts.songOffset ?? 0,
      },
      signal,
    );
    return r.searchResult3 ?? {};
  }

  // ---- playlists --------------------------------------------------------

  async playlists(): Promise<Playlist[]> {
    const r = await this.get<{ playlists?: { playlist?: Playlist[] } }>("getPlaylists");
    return r.playlists?.playlist ?? [];
  }

  async playlist(id: string): Promise<PlaylistWithSongs> {
    const r = await this.get<{ playlist: PlaylistWithSongs }>("getPlaylist", { id });
    return r.playlist;
  }

  async createPlaylist(name: string, songIds: string[] = []): Promise<PlaylistWithSongs | undefined> {
    const r = await this.get<{ playlist?: PlaylistWithSongs }>("createPlaylist", { name, songId: songIds });
    return r.playlist;
  }

  async updatePlaylist(
    id: string,
    changes: { name?: string; comment?: string; add?: string[]; removeIndexes?: number[] },
  ) {
    await this.get("updatePlaylist", {
      playlistId: id,
      name: changes.name,
      comment: changes.comment,
      songIdToAdd: changes.add,
      songIndexToRemove: changes.removeIndexes,
    });
  }

  async deletePlaylist(id: string) {
    await this.get("deletePlaylist", { id });
  }

  // ---- annotations ------------------------------------------------------

  async setStarred(kind: "song" | "album" | "artist", id: string, starred: boolean) {
    const key = kind === "song" ? "id" : kind === "album" ? "albumId" : "artistId";
    await this.get(starred ? "star" : "unstar", { [key]: id });
  }

  async scrobble(id: string, submission: boolean, time?: number) {
    await this.get("scrobble", { id, submission, time });
  }

  // ---- lyrics -----------------------------------------------------------

  async lyricsBySongId(id: string): Promise<StructuredLyrics[]> {
    const r = await this.get<{ lyricsList?: { structuredLyrics?: StructuredLyrics[] } }>("getLyricsBySongId", { id });
    return r.lyricsList?.structuredLyrics ?? [];
  }

  async lyrics(artist: string, title: string): Promise<string | undefined> {
    const r = await this.get<{ lyrics?: { value?: string } }>("getLyrics", { artist, title });
    return r.lyrics?.value;
  }
}
