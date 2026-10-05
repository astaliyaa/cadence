# Cadence

An Apple Music–style desktop client for **Navidrome**, built with [Tauri 2](https://v2.tauri.app) (Rust) and React.

- **Looks like Apple Music:** translucent sidebar (Mica on Windows 11, vibrancy on macOS), the LCD-style player bar, album pages with motion artwork, and a full-screen player with an animated artwork background and synced lyrics.
- **Fast:** uses the system WebView instead of bundling Chromium (small install, ~10 MB). Every long list and grid is virtualised. Cover art is requested at a fixed set of sizes so it can be cached (configurable quality, up to full-resolution originals). Progress bars and lyrics animate without re-rendering React.
- **Navidrome-native:** uses the Subsonic API with OpenSubsonic extensions, including synced lyrics, ReplayGain, release types, lossless/hi-res info and favorites.

> **iPhone app:** a native SwiftUI version lives in [`ios/`](ios/). It's built and shipped to TestFlight by GitHub Actions, so no Mac is needed. See [ios/README.md](ios/README.md).

## Features

| | |
|---|---|
| Library | Home (top picks, recently played/added, most played, favorites, discover), Recently Added, Artists (split view), Albums (sortable), Songs, Genres, Favorites, Playlists |
| Playback | Near-gapless (next track preloaded on a second audio element), shuffle/repeat, Up Next queue with drag-to-reorder, history, Autoplay (similar songs when the queue ends), session restore, ALAC/unsupported-codec fallback to transcoding |
| Lyrics | Navidrome synced lyrics, embedded LRC, LRCLIB fallback. Apple-style animated line scrolling with blur, click a line to seek |
| OS integration | Windows media overlay / media keys (SMTC), macOS Now Playing, Linux MPRIS |
| Sound | Sound Check (ReplayGain), server-side transcoding presets |
| Other | Scrobbling (Navidrome forwards it to Last.fm/ListenBrainz), playlists (create, rename, delete, add/remove songs, drag songs onto a playlist), right-click menus everywhere, light/dark/auto theme, accent colours, keyboard shortcuts |

## Installing

Download the installer for your system from the [Releases](../../releases) page:

| System | File |
|---|---|
| Windows 10/11 | `Cadence_x.y.z_x64-setup.exe` (installs for your user, no admin needed) |
| macOS 13+ | `Cadence_x.y.z_universal.dmg` (Apple Silicon and Intel) |
| Linux | `.AppImage` or `.deb` |

The Windows installer isn't code-signed yet. The first time you run it, Windows SmartScreen may say "Windows protected your PC". Click **More info → Run anyway**.

## Building from source

Requirements: Node 20+, Rust (stable). On Windows you also need the Visual Studio C++ build tools. On Linux you need `libwebkit2gtk-4.1-dev`, `libdbus-1-dev` and the other packages from the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/).

```bash
npm install
```

```bash
npm run app
```

`npm run app` starts Vite and opens the desktop window with hot reload.

To build an installer for the system you're on (output goes to `src-tauri/target/release/bundle/`), run one of these:

```bash
npm run dist:win
```

```bash
npm run dist:mac
```

```bash
npm run dist:linux
```

## Publishing a release

1. Bump `version` in `package.json`. It's the only place the app version lives; the installer and the Settings page both read it.
2. Push the project to GitHub, then push a version tag:
   ```bash
   git tag v0.1.0
   ```
   ```bash
   git push origin v0.1.0
   ```
3. [`.github/workflows/release.yml`](.github/workflows/release.yml) builds the Windows, macOS and Linux installers and attaches them to a **draft** release. Check it, then publish it.

**macOS signing:** with an Apple Developer account you can sign and notarize the Mac build so it opens without warnings. Create a *Developer ID Application* certificate, then add the secrets listed at the top of the workflow file to the GitHub repository. Without them the Mac build still works, but users have to right-click → Open the first time.

**Windows signing:** this needs a code-signing certificate, for example [Azure Trusted Signing](https://learn.microsoft.com/azure/trusted-signing/). Until then, users see the SmartScreen prompt described above.

### Trying it without your server

`dev/mock-server.mjs` is a fake Navidrome with a generated library, synthesized audio, and synced lyrics:

```bash
npm run mock
```

Then sign in to `http://localhost:4533` with the username `demo` and the password `demo`.

## Animated album artwork (Apple Developer account)

Cadence can look up each album in the Apple Music catalog and play its **motion artwork** on album pages and in the full-screen player.

1. In your Apple Developer account, open **Certificates, Identifiers & Profiles → Keys**, create a key with **MusicKit** enabled, and download the `.p8` file.
2. In Cadence, open **Settings → Animated Artwork**, turn it on, and fill in your **Team ID** and **Key ID**. Then choose the `.p8` file.
3. Press **Test**.

The developer token is signed locally in Rust and never leaves your machine except to call `api.music.apple.com`. Matches are cached, so each album is looked up at most once every few days.

> **Heads-up:** Apple officially says `editorialVideo` (the motion artwork) [isn't returned to third-party developer tokens](https://developer.apple.com/forums/thread/696843). The Test button tells you whether your token gets it.

**Web player token.** Apple's own web player at music.apple.com has a token that does get motion artwork. You have two ways to use it:

- **Automatic (recommended):** turn on **Get token from music.apple.com**. Cadence reads the token from the web player's script and saves it to its app data folder. It fetches a new one when the saved token is within a day of expiring or Apple rejects it.
- **Manual:** copy the `authorization: Bearer …` header from any `amp-api.music.apple.com` request in your browser's DevTools and paste it into **Developer token**. You'll need to repeat this when it expires, roughly every couple of months.

Cadence recognizes these tokens and sends them to the web player's API host with the origin it expects. This isn't an officially supported use of Apple's token, so it can stop working whenever Apple changes their site.

Your Apple Developer account is also what you'd use to sign and notarize the macOS build. Build it on a Mac with `npm run app:build`.

## Keyboard shortcuts

| Keys | Action |
|---|---|
| Space | Play / pause |
| Ctrl/⌘ → / ← | Next / previous |
| Ctrl/⌘ ↑ / ↓ | Volume |
| Ctrl/⌘ F | Search |
| Ctrl/⌘ L | Lyrics panel |
| Ctrl/⌘ U | Playing Next panel |
| Ctrl/⌘ Shift F | Full-screen player |

## Project layout

```
src/
  api/          Subsonic client, types, React Query hooks
  player/       audio engine (two <audio> elements) + queue store
  lyrics/       lyrics fetching (Navidrome → LRC → LRCLIB) and the animated view
  components/   player bar, sidebar, now playing, cards, track table, ...
  pages/        Home, Album, Artist, Playlist, Library, Search, Settings, Login
  styles/       app.css — all theming lives here (CSS variables)
src-tauri/src/
  lib.rs        window setup, Mica/vibrancy
  media.rs      OS media controls (souvlaki)
  motion.rs     Apple Music developer-token signing + motion artwork lookup
  proxy.rs      proxy:// protocol for CORS-restricted hosts (Apple CDN, LRCLIB)
dev/mock-server.mjs   fake Navidrome for development
```

## Notes

- Sign-in stores the server URL, username and a salted MD5 token (standard Subsonic auth), not your password.
- On Windows the font is Inter. On macOS it uses SF Pro, Apple Music's own font.
- Rename the app by changing `productName`/`identifier` in `src-tauri/tauri.conf.json`.

## License

[MIT](LICENSE). Cadence bundles the [Inter](https://rsms.me/inter/) typeface (SIL Open Font License 1.1) and uses [Lucide](https://lucide.dev) icons (ISC), [hls.js](https://github.com/video-dev/hls.js) (Apache-2.0), React (MIT) and Tauri (MIT/Apache-2.0).

Cadence isn't affiliated with Apple or Navidrome. Animated artwork and lyrics come from third-party services; see the notes above.
