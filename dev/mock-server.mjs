// A tiny fake Navidrome (Subsonic + OpenSubsonic) for developing the UI offline.
//   npm run mock   ->  http://localhost:4533   user: demo   password: demo
// Covers are generated SVGs and every "song" is a short synthesized WAV.
import http from "node:http";
import crypto from "node:crypto";

const PORT = Number(process.env.PORT ?? 4533);
const USER = "demo";
const PASS = "demo";

// ---- deterministic fake library ---------------------------------------------

let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];

const ARTISTS = [
  "Aurora Vale", "The Glass Pilots", "Mira Okafor", "Northbound Static", "Juniper & Wolf",
  "Sable Coast", "Kenji Arata", "Velvet Arcade", "Low Tide Choir", "Ines Moreau",
  "Paper Satellites", "Cobalt Youth", "Hollow Pines", "Luma Reyes",
];
const WORDS = ["Neon", "Glass", "Summer", "Midnight", "Paper", "Golden", "Static", "Velvet", "Silver", "Hollow", "Electric", "Quiet", "Wild", "Distant", "Lucid", "Ember", "Crimson", "Ocean", "Northern", "Satellite"];
const NOUNS = ["Rivers", "Hearts", "Signals", "Gardens", "Machines", "Dreams", "Skylines", "Echoes", "Letters", "Mornings", "Fires", "Waves", "Lights", "Roads", "Shadows", "Bloom", "Horizon", "Weather"];
const GENRES = ["Indie Pop", "Electronic", "Alternative", "R&B", "Jazz", "Ambient", "Rock", "Hip-Hop", "Folk", "Synthwave"];
const LYRIC_BITS = [
  "We were dancing on the edge of the evening", "Every window lit like a hundred little suns", "Hold on, the night is young and so are we",
  "I wrote your name across the fogged-up glass", "Turn the radio up, let the static sing", "Running through the city with our hands up high",
  "Nothing ever stays the same, but we do", "Call me when the morning finds you", "There's a light that never sleeps in this town",
  "Paper hearts and silver lines", "Tell me what you're dreaming of", "We could be the echo of a better song",
  "Oh, oh, oh", "Don't let go, don't let go", "All the colors bleeding into one", "Slow it down, slow it down",
];

const artists = ARTISTS.map((name, i) => ({ id: `ar${i + 1}`, name }));
const albums = [];
const songs = [];
let songN = 0;

for (const artist of artists) {
  const count = 1 + Math.floor(rnd() * 4);
  for (let a = 0; a < count; a++) {
    const id = `al${albums.length + 1}`;
    const name = `${pick(WORDS)} ${pick(NOUNS)}`;
    const year = 2008 + Math.floor(rnd() * 17);
    const genre = pick(GENRES);
    const single = rnd() < 0.2;
    const trackCount = single ? 1 + Math.floor(rnd() * 2) : 6 + Math.floor(rnd() * 8);
    const discs = !single && rnd() < 0.15 ? 2 : 1;
    const lossless = rnd() < 0.55;
    const hires = lossless && rnd() < 0.4;
    const album = {
      id, name, artist: artist.name, artistId: artist.id, coverArt: `al-${id}`, year, genre,
      genres: [{ name: genre }], songCount: trackCount, duration: 0, playCount: Math.floor(rnd() * 40),
      created: new Date(Date.UTC(2024, Math.floor(rnd() * 12), 1 + Math.floor(rnd() * 27))).toISOString(),
      releaseTypes: [single ? "Single" : "Album"], recordLabels: [{ name: `${pick(WORDS)} Records` }],
      releaseDate: { year, month: 1 + Math.floor(rnd() * 12), day: 1 + Math.floor(rnd() * 27) },
      explicitStatus: rnd() < 0.2 ? "explicit" : "", starred: rnd() < 0.25 ? "2025-01-01T00:00:00Z" : undefined,
    };
    for (let t = 0; t < trackCount; t++) {
      const sid = `s${++songN}`;
      const duration = 45 + Math.floor(rnd() * 75);
      const disc = discs === 2 && t >= trackCount / 2 ? 2 : 1;
      songs.push({
        id: sid, title: rnd() < 0.5 ? `${pick(WORDS)} ${pick(NOUNS)}` : `${pick(NOUNS)} (${pick(WORDS)} Mix)`.replace(" Mix)", ")"),
        album: name, albumId: id, artist: artist.name, artistId: artist.id, coverArt: `al-${id}`,
        track: disc === 2 ? t + 1 - Math.ceil(trackCount / 2) : t + 1, discNumber: disc, year, genre, duration,
        suffix: lossless ? "flac" : "mp3", bitRate: lossless ? 900 : 320, bitDepth: lossless ? (hires ? 24 : 16) : 0,
        samplingRate: hires ? 96000 : 44100, contentType: "audio/wav", playCount: Math.floor(rnd() * 60),
        starred: rnd() < 0.12 ? "2025-01-01T00:00:00Z" : undefined, explicitStatus: album.explicitStatus,
        replayGain: { trackGain: -6 - rnd() * 4, albumGain: -7 },
      });
      album.duration += duration;
    }
    albums.push(album);
  }
}
for (const ar of artists) ar.albumCount = albums.filter((a) => a.artistId === ar.id).length;

const playlists = [
  { id: "pl1", name: "Late Night Drive", comment: "Windows down, city lights.", songIds: songs.filter((_, i) => i % 7 === 0).map((s) => s.id) },
  { id: "pl2", name: "Focus", comment: "", songIds: songs.filter((s) => s.genre === "Ambient" || s.genre === "Electronic").slice(0, 25).map((s) => s.id) },
  { id: "pl3", name: "Sunday Morning", comment: "Coffee and slow songs.", songIds: songs.filter((_, i) => i % 11 === 3).map((s) => s.id) },
];

const byId = (list, id) => list.find((x) => x.id === id);
const albumSongs = (id) => songs.filter((s) => s.albumId === id).sort((a, b) => a.discNumber - b.discNumber || a.track - b.track);
const plOut = (p) => {
  const entries = p.songIds.map((id) => byId(songs, id)).filter(Boolean);
  return { id: p.id, name: p.name, comment: p.comment, owner: USER, public: false, songCount: entries.length, duration: entries.reduce((s, x) => s + x.duration, 0), coverArt: `pl-${p.id}`, created: "2025-01-01T00:00:00Z", changed: "2025-02-01T00:00:00Z" };
};

// ---- media generation ---------------------------------------------------------

function hash(s) {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0;
  return Math.abs(h);
}

function coverSvg(id) {
  const h = hash(id);
  const h1 = h % 360, h2 = (h1 + 40 + (h % 90)) % 360, h3 = (h1 + 180) % 360;
  const isArtist = id.startsWith("ar-");
  const label = isArtist ? byId(artists, id.slice(3))?.name ?? "" : id.startsWith("pl-") ? byId(playlists, id.slice(3))?.name ?? "" : byId(albums, id.slice(3))?.name ?? "";
  const shape = h % 3 === 0
    ? `<circle cx="${30 + (h % 40)}%" cy="${35 + (h % 30)}%" r="28%" fill="hsl(${h3} 85% 65%)" opacity=".85"/>`
    : h % 3 === 1
      ? `<rect x="18%" y="18%" width="64%" height="64%" rx="8" transform="rotate(${h % 45} 300 300)" fill="hsl(${h3} 80% 60%)" opacity=".75"/>`
      : `<path d="M0 ${380 + (h % 120)} Q 300 ${200 + (h % 100)} 600 ${420 + (h % 80)} V600 H0Z" fill="hsl(${h3} 80% 60%)" opacity=".8"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600" viewBox="0 0 600 600">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${h1} 75% 55%)"/><stop offset="1" stop-color="hsl(${h2} 70% 28%)"/></linearGradient></defs>
<rect width="600" height="600" fill="url(#g)"/>${shape}
${isArtist ? `<circle cx="300" cy="250" r="95" fill="rgba(255,255,255,.85)"/><path d="M110 600 C 140 420 460 420 490 600Z" fill="rgba(255,255,255,.85)"/>` : `<text x="40" y="545" font-family="Segoe UI, Helvetica, Arial" font-weight="700" font-size="44" fill="rgba(255,255,255,.92)">${label.replace(/&/g, "&amp;")}</text>`}
</svg>`;
}

const wavCache = new Map();
function songWav(song) {
  if (wavCache.has(song.id)) return wavCache.get(song.id);
  const rate = 16000;
  const n = rate * song.duration;
  const data = Buffer.alloc(n * 2);
  const h = hash(song.id);
  const root = 196 * Math.pow(2, (h % 12) / 12);
  const scale = [0, 2, 4, 7, 9, 12, 14, 16];
  const beat = 60 / (84 + (h % 40));
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    const step = Math.floor(t / (beat / 2));
    const note = root * Math.pow(2, scale[(step * 3 + (h % 5)) % scale.length] / 12);
    const env = Math.exp(-((t % (beat / 2)) * 6));
    const pad = 0.12 * (Math.sin(2 * Math.PI * root * 0.5 * t) + 0.6 * Math.sin(2 * Math.PI * root * 0.75 * t));
    const fade = Math.min(1, t / 0.5, (song.duration - t) / 1.5);
    const v = (0.35 * env * Math.sin(2 * Math.PI * note * t) + pad) * fade * 0.6;
    data.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(v * 32767))), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0); header.writeUInt32LE(36 + data.length, 4); header.write("WAVE", 8);
  header.write("fmt ", 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24); header.writeUInt32LE(rate * 2, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
  header.write("data", 36); header.writeUInt32LE(data.length, 40);
  const buf = Buffer.concat([header, data]);
  wavCache.set(song.id, buf);
  return buf;
}

function lyricsFor(song) {
  const h = hash(song.id);
  const lines = [];
  let t = 6 + (h % 5);
  let i = h;
  while (t < song.duration - 4) {
    lines.push({ start: Math.round(t * 1000), value: LYRIC_BITS[i++ % LYRIC_BITS.length] });
    t += 3 + ((i * 7) % 4);
    if (i % 9 === 0 && t < song.duration - 14) {
      lines.push({ start: Math.round(t * 1000), value: "" });
      t += 7;
    }
  }
  return lines;
}

// ---- HTTP --------------------------------------------------------------------

const ok = (payload = {}) => ({ "subsonic-response": { status: "ok", version: "1.16.1", type: "navidrome", serverVersion: "0.53.3 (mock)", openSubsonic: true, ...payload } });
const fail = (code, message) => ({ "subsonic-response": { status: "failed", version: "1.16.1", type: "navidrome", openSubsonic: true, error: { code, message } } });

function sortAlbums(type, q) {
  const list = albums.slice();
  switch (type) {
    case "newest": return list.sort((a, b) => b.created.localeCompare(a.created));
    case "alphabeticalByName": return list.sort((a, b) => a.name.localeCompare(b.name));
    case "alphabeticalByArtist": return list.sort((a, b) => a.artist.localeCompare(b.artist) || a.year - b.year);
    case "frequent": return list.sort((a, b) => b.playCount - a.playCount);
    case "recent": return list.filter((a) => a.played).sort((a, b) => b.played.localeCompare(a.played));
    case "starred": return list.filter((a) => a.starred);
    case "byYear": {
      const from = Number(q.get("fromYear") ?? 0), to = Number(q.get("toYear") ?? 3000);
      return list.filter((a) => a.year >= Math.min(from, to) && a.year <= Math.max(from, to)).sort((a, b) => (from > to ? b.year - a.year : a.year - b.year));
    }
    case "byGenre": return list.filter((a) => a.genre === q.get("genre"));
    case "highest": return list.sort((a, b) => b.playCount - a.playCount).slice(0, 10);
    default: return list.sort(() => rnd() - 0.5);
  }
}

function handle(endpoint, q) {
  switch (endpoint) {
    case "ping": return ok();
    case "getOpenSubsonicExtensions": return ok({ openSubsonicExtensions: [{ name: "songLyrics", versions: [1] }, { name: "formPost", versions: [1] }] });
    case "getAlbumList2": {
      const size = Number(q.get("size") ?? 10), offset = Number(q.get("offset") ?? 0);
      return ok({ albumList2: { album: sortAlbums(q.get("type"), q).slice(offset, offset + size) } });
    }
    case "getAlbum": {
      const a = byId(albums, q.get("id"));
      return a ? ok({ album: { ...a, song: albumSongs(a.id) } }) : fail(70, "Album not found");
    }
    case "getArtists": {
      const index = {};
      for (const a of artists) (index[a.name[0].toUpperCase()] ??= []).push({ ...a, coverArt: `ar-${a.id}` });
      return ok({ artists: { ignoredArticles: "The", index: Object.entries(index).sort().map(([name, artist]) => ({ name, artist })) } });
    }
    case "getArtist": {
      const a = byId(artists, q.get("id"));
      return a ? ok({ artist: { ...a, coverArt: `ar-${a.id}`, album: albums.filter((x) => x.artistId === a.id) } }) : fail(70, "Artist not found");
    }
    case "getArtistInfo2": {
      const a = byId(artists, q.get("id"));
      return ok({ artistInfo2: { biography: `${a?.name} is a fictional act generated by the Cadence mock server. Their records blend ${pick(GENRES).toLowerCase()} textures with ${pick(GENRES).toLowerCase()} rhythms, and every song you hear here is synthesized on the fly. <a href="#">Read more on Last.fm</a>`, similarArtist: artists.filter((x) => x.id !== a?.id).slice(0, 6).map((x) => ({ ...x, coverArt: `ar-${x.id}` })) } });
    }
    case "getTopSongs": {
      const list = songs.filter((s) => s.artist === q.get("artist")).sort((a, b) => b.playCount - a.playCount);
      return ok({ topSongs: { song: list.slice(0, Number(q.get("count") ?? 10)) } });
    }
    case "getSimilarSongs2":
    case "getRandomSongs": {
      const genre = q.get("genre");
      const pool = songs.filter((s) => !genre || s.genre === genre).slice().sort(() => rnd() - 0.5);
      const key = endpoint === "getRandomSongs" ? "randomSongs" : "similarSongs2";
      return ok({ [key]: { song: pool.slice(0, Number(q.get("size") ?? q.get("count") ?? 20)) } });
    }
    case "getSong": return ok({ song: byId(songs, q.get("id")) });
    case "getGenres": return ok({ genres: { genre: GENRES.map((g) => ({ value: g, songCount: songs.filter((s) => s.genre === g).length, albumCount: albums.filter((a) => a.genre === g).length })) } });
    case "getStarred2": return ok({ starred2: { artist: artists.filter((a) => a.starred).map((a) => ({ ...a, coverArt: `ar-${a.id}` })), album: albums.filter((a) => a.starred), song: songs.filter((s) => s.starred) } });
    case "star":
    case "unstar": {
      const val = endpoint === "star" ? new Date().toISOString() : undefined;
      for (const id of q.getAll("id")) { const s = byId(songs, id); if (s) s.starred = val; }
      for (const id of q.getAll("albumId")) { const a = byId(albums, id); if (a) a.starred = val; }
      for (const id of q.getAll("artistId")) { const a = byId(artists, id); if (a) a.starred = val; }
      return ok();
    }
    case "scrobble": {
      const s = byId(songs, q.get("id"));
      if (s && q.get("submission") !== "false") {
        s.playCount++;
        const a = byId(albums, s.albumId);
        a.playCount++;
        a.played = new Date().toISOString();
      }
      return ok();
    }
    case "search3": {
      const term = (q.get("query") ?? "").replace(/"/g, "").toLowerCase().trim();
      const m = (s) => !term || s.toLowerCase().includes(term);
      const sl = (list, c, o) => list.slice(Number(q.get(o) ?? 0), Number(q.get(o) ?? 0) + Number(q.get(c) ?? 20));
      return ok({ searchResult3: {
        artist: sl(artists.filter((a) => m(a.name)).map((a) => ({ ...a, coverArt: `ar-${a.id}` })), "artistCount", "artistOffset"),
        album: sl(albums.filter((a) => m(a.name) || m(a.artist)), "albumCount", "albumOffset"),
        song: sl(songs.filter((s) => m(s.title) || m(s.artist) || m(s.album)), "songCount", "songOffset"),
      } });
    }
    case "getPlaylists": return ok({ playlists: { playlist: playlists.map(plOut) } });
    case "getPlaylist": {
      const p = byId(playlists, q.get("id"));
      return p ? ok({ playlist: { ...plOut(p), entry: p.songIds.map((id) => byId(songs, id)).filter(Boolean) } }) : fail(70, "Playlist not found");
    }
    case "createPlaylist": {
      const p = { id: `pl${Date.now()}`, name: q.get("name") ?? "New Playlist", comment: "", songIds: q.getAll("songId") };
      playlists.push(p);
      return ok({ playlist: { ...plOut(p), entry: p.songIds.map((id) => byId(songs, id)) } });
    }
    case "updatePlaylist": {
      const p = byId(playlists, q.get("playlistId"));
      if (!p) return fail(70, "Playlist not found");
      if (q.get("name")) p.name = q.get("name");
      if (q.has("comment")) p.comment = q.get("comment");
      const remove = new Set(q.getAll("songIndexToRemove").map(Number));
      p.songIds = p.songIds.filter((_, i) => !remove.has(i)).concat(q.getAll("songIdToAdd"));
      return ok();
    }
    case "deletePlaylist": {
      const i = playlists.findIndex((p) => p.id === q.get("id"));
      if (i >= 0) playlists.splice(i, 1);
      return ok();
    }
    case "getLyricsBySongId": {
      const s = byId(songs, q.get("id"));
      if (!s || hash(s.id) % 6 === 0) return ok({ lyricsList: { structuredLyrics: [] } });
      return ok({ lyricsList: { structuredLyrics: [{ lang: "eng", synced: true, displayArtist: s.artist, displayTitle: s.title, line: lyricsFor(s) }] } });
    }
    case "getLyrics": return ok({ lyrics: {} });
    default: return fail(0, `Mock server doesn't implement ${endpoint}`);
  }
}

http
  .createServer((req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Expose-Headers", "Content-Range, Content-Length");
    if (req.method === "OPTIONS") return res.writeHead(204).end();
    const m = url.pathname.match(/^\/rest\/(\w+?)(\.view)?$/);
    if (!m) return res.writeHead(404).end("not found");
    const endpoint = m[1];
    const q = url.searchParams;

    const expected = crypto.createHash("md5").update(PASS + (q.get("s") ?? "")).digest("hex");
    if (q.get("u") !== USER || q.get("t") !== expected) {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify(fail(40, "Wrong username or password")));
    }

    if (endpoint === "getCoverArt") {
      res.writeHead(200, { "Content-Type": "image/svg+xml", "Cache-Control": "public, max-age=86400" });
      return res.end(coverSvg(q.get("id") ?? ""));
    }
    if (endpoint === "stream") {
      const s = byId(songs, q.get("id"));
      if (!s) return res.writeHead(404).end();
      const buf = songWav(s);
      const range = req.headers.range?.match(/bytes=(\d*)-(\d*)/);
      if (range) {
        const start = Number(range[1] || 0);
        const end = range[2] ? Math.min(Number(range[2]), buf.length - 1) : buf.length - 1;
        res.writeHead(206, { "Content-Type": "audio/wav", "Accept-Ranges": "bytes", "Content-Range": `bytes ${start}-${end}/${buf.length}`, "Content-Length": end - start + 1 });
        return res.end(buf.subarray(start, end + 1));
      }
      res.writeHead(200, { "Content-Type": "audio/wav", "Accept-Ranges": "bytes", "Content-Length": buf.length });
      return res.end(buf);
    }

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(handle(endpoint, q)));
  })
  .listen(PORT, () => {
    console.log(`Mock Navidrome on http://localhost:${PORT}  (user "${USER}", password "${PASS}")`);
    console.log(`${artists.length} artists, ${albums.length} albums, ${songs.length} songs`);
  });
