// Subsonic / OpenSubsonic shapes as returned by Navidrome (only the fields we use).

export interface ArtistRef {
  id: string;
  name: string;
}

export interface ReplayGain {
  trackGain?: number;
  albumGain?: number;
  trackPeak?: number;
  albumPeak?: number;
}

export interface Song {
  id: string;
  title: string;
  album?: string;
  albumId?: string;
  artist?: string;
  artistId?: string;
  artists?: ArtistRef[];
  displayArtist?: string;
  albumArtists?: ArtistRef[];
  displayAlbumArtist?: string;
  track?: number;
  discNumber?: number;
  year?: number;
  genre?: string;
  coverArt?: string;
  duration?: number;
  bitRate?: number;
  bitDepth?: number;
  samplingRate?: number;
  channelCount?: number;
  suffix?: string;
  contentType?: string;
  size?: number;
  starred?: string;
  playCount?: number;
  userRating?: number;
  replayGain?: ReplayGain;
  explicitStatus?: string;
  bpm?: number;
}

export interface ItemDate {
  year?: number;
  month?: number;
  day?: number;
}

export interface Album {
  id: string;
  name: string;
  artist?: string;
  artistId?: string;
  artists?: ArtistRef[];
  displayArtist?: string;
  coverArt?: string;
  songCount?: number;
  duration?: number;
  playCount?: number;
  created?: string;
  played?: string;
  year?: number;
  genre?: string;
  genres?: { name: string }[];
  starred?: string;
  userRating?: number;
  recordLabels?: { name: string }[];
  releaseTypes?: string[];
  releaseDate?: ItemDate;
  originalReleaseDate?: ItemDate;
  isCompilation?: boolean;
  explicitStatus?: string;
  version?: string;
  discTitles?: { disc: number; title: string }[];
}

export interface AlbumWithSongs extends Album {
  song?: Song[];
}

export interface Artist {
  id: string;
  name: string;
  coverArt?: string;
  artistImageUrl?: string;
  albumCount?: number;
  starred?: string;
  sortName?: string;
}

export interface ArtistWithAlbums extends Artist {
  album?: Album[];
}

export interface ArtistInfo {
  biography?: string;
  musicBrainzId?: string;
  lastFmUrl?: string;
  smallImageUrl?: string;
  mediumImageUrl?: string;
  largeImageUrl?: string;
  similarArtist?: Artist[];
}

export interface Playlist {
  id: string;
  name: string;
  comment?: string;
  owner?: string;
  public?: boolean;
  songCount: number;
  duration: number;
  created?: string;
  changed?: string;
  coverArt?: string;
  readonly?: boolean;
}

export interface PlaylistWithSongs extends Playlist {
  entry?: Song[];
}

export interface Genre {
  value: string;
  songCount: number;
  albumCount: number;
}

export interface SearchResult {
  artist?: Artist[];
  album?: Album[];
  song?: Song[];
}

export interface Starred {
  artist?: Artist[];
  album?: Album[];
  song?: Song[];
}

export interface LyricLine {
  start?: number; // ms
  value: string;
}

export interface StructuredLyrics {
  lang?: string;
  synced: boolean;
  line?: LyricLine[];
  displayArtist?: string;
  displayTitle?: string;
  offset?: number;
}

export type AlbumListType =
  | "random"
  | "newest"
  | "highest"
  | "frequent"
  | "recent"
  | "alphabeticalByName"
  | "alphabeticalByArtist"
  | "starred"
  | "byYear"
  | "byGenre";

export interface Credentials {
  server: string;
  username: string;
  salt: string;
  token: string;
}
