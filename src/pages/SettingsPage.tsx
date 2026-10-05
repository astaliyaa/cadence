import { useRef, useState, type ReactNode } from "react";
import { useAuth } from "../store/auth";
import { ACCENTS, useSettings, type ArtworkQuality, type ThemePref } from "../store/settings";
import { confirmAction, useUI } from "../store/ui";
import { usePlayer } from "../player/store";
import { engine } from "../player/engine";
import { PageTitle, Segmented } from "../components/Common";
import { clearMotionCache, motionConfig } from "../components/MotionArtwork";
import { invoke, isTauri, openExternal } from "../lib/platform";
import { queryClient } from "../api/queryClient";

function Group({ title, footer, children }: { title: string; footer?: ReactNode; children: ReactNode }) {
  return (
    <section className="settings-group">
      <h3>{title}</h3>
      <div className="settings-card">{children}</div>
      {footer && <div className="settings-footer">{footer}</div>}
    </section>
  );
}

function Row({ label, detail, children }: { label: string; detail?: ReactNode; children?: ReactNode }) {
  return (
    <div className="settings-row">
      <div className="settings-label">
        <div>{label}</div>
        {detail && <div className="settings-detail">{detail}</div>}
      </div>
      <div className="settings-control">{children}</div>
    </div>
  );
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button role="switch" aria-checked={checked} aria-label={label} className={`switch${checked ? " on" : ""}`} onClick={() => onChange(!checked)}>
      <span />
    </button>
  );
}

const QUALITY = [
  { label: "Original (no transcoding)", format: "raw", bitrate: 0 },
  { label: "High — 320 kbps", format: "mp3", bitrate: 320 },
  { label: "High — Opus 192 kbps", format: "opus", bitrate: 192 },
  { label: "Medium — 192 kbps", format: "mp3", bitrate: 192 },
  { label: "Data Saver — 128 kbps", format: "mp3", bitrate: 128 },
] as const;

const SHORTCUTS: [string, string][] = [
  ["Space", "Play / Pause"],
  ["Ctrl/⌘ →", "Next song"],
  ["Ctrl/⌘ ←", "Previous song"],
  ["Ctrl/⌘ ↑ / ↓", "Volume up / down"],
  ["Ctrl/⌘ F", "Search"],
  ["Ctrl/⌘ L", "Lyrics"],
  ["Ctrl/⌘ U", "Playing Next"],
  ["Ctrl/⌘ Shift F", "Full-screen player"],
  ["Esc", "Close full-screen player"],
];

function MotionSettingsGroup() {
  const motion = useSettings((s) => s.motion);
  const setMotion = useSettings((s) => s.setMotion);
  const toast = useUI((s) => s.toast);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const test = async () => {
    setTesting(true);
    setResult(null);
    try {
      const r = await invoke<{ tokenOk: boolean; motionAvailable: boolean; message: string }>("motion_test", {
        config: motionConfig(motion),
      });
      setResult({ ok: r.tokenOk && r.motionAvailable, text: r.message });
    } catch (e) {
      setResult({ ok: false, text: String(e) });
    } finally {
      setTesting(false);
    }
  };

  return (
    <Group
      title="Animated Artwork"
      footer={
        motion.autoRefresh ? (
          <>
            Looks up each album in the Apple Music catalog and plays its motion artwork on album pages and in the full-screen player. Cadence uses the token built into Apple's web player (music.apple.com) and fetches a new
            one when it expires. This isn't an officially supported use of that token, so Apple may block it or change their site at any time.
          </>
        ) : (
          <>
            Looks up each album in the Apple Music catalog and plays its motion artwork on album pages and in the full-screen player. Create a <b>MusicKit</b> key under Certificates, Identifiers &amp; Profiles → Keys in your Apple Developer account, then
            paste its Key ID, your Team ID and the contents of the downloaded <code>.p8</code> file. Apple only returns motion artwork (<code>editorialVideo</code>) to some tokens — use “Test” to see whether yours gets it.{" "}
            <button className="link" onClick={() => openExternal("https://developer.apple.com/account/resources/authkeys/list")}>
              Open Apple Developer Keys
            </button>
          </>
        )
      }
    >
      <Row label="Show animated artwork" detail={!isTauri ? "Only available in the desktop app" : undefined}>
        <Toggle label="Show animated artwork" checked={motion.enabled} onChange={(v) => setMotion({ enabled: v })} />
      </Row>
      {motion.enabled && (
        <Row label="Get token from music.apple.com" detail="Uses Apple's web player token and fetches a new one automatically when it expires">
          <Toggle label="Get token from music.apple.com" checked={!!motion.autoRefresh} onChange={(v) => setMotion({ autoRefresh: v })} />
        </Row>
      )}
      {motion.enabled && !motion.autoRefresh && (
        <>
          <Row label="Team ID">
            <input className="text-field mono" value={motion.teamId} onChange={(e) => setMotion({ teamId: e.target.value.trim() })} placeholder="ABCDE12345" spellCheck={false} />
          </Row>
          <Row label="Key ID">
            <input className="text-field mono" value={motion.keyId} onChange={(e) => setMotion({ keyId: e.target.value.trim() })} placeholder="XYZ987WVUT" spellCheck={false} />
          </Row>
          <Row label="Private key (.p8)" detail={motion.privateKey ? "Key loaded" : "Paste the file contents or choose the file"}>
            <div className="row-buttons">
              <button className="btn secondary" onClick={() => fileRef.current?.click()}>
                Choose File…
              </button>
              {motion.privateKey && (
                <button className="btn secondary" onClick={() => setMotion({ privateKey: "" })}>
                  Remove
                </button>
              )}
              <input
                ref={fileRef}
                type="file"
                accept=".p8,.pem,.txt"
                hidden
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (f) setMotion({ privateKey: await f.text() });
                  e.target.value = "";
                }}
              />
            </div>
          </Row>
          {!motion.privateKey && (
            <div className="settings-row block">
              <textarea className="text-field mono" rows={4} placeholder="-----BEGIN PRIVATE KEY-----" onBlur={(e) => e.target.value.trim() && setMotion({ privateKey: e.target.value })} />
            </div>
          )}
          <Row label="Developer token" detail="Optional — used instead of the key fields. Accepts a music.apple.com web player token.">
            <input className="text-field mono" value={motion.token} onChange={(e) => setMotion({ token: e.target.value.trim() })} placeholder="eyJhbGciOiJFUzI1NiIs…" spellCheck={false} />
          </Row>
        </>
      )}
      {motion.enabled && (
        <>
          <Row label="Storefront" detail="Two-letter Apple Music country code">
            <input className="text-field mono short" value={motion.storefront} maxLength={2} onChange={(e) => setMotion({ storefront: e.target.value.toLowerCase() })} />
          </Row>
          <Row label="Connection" detail={result ? <span className={result.ok ? "ok-text" : "warn-text"}>{result.text}</span> : undefined}>
            <div className="row-buttons">
              <button className="btn secondary" onClick={test} disabled={testing || !isTauri}>
                {testing ? "Testing…" : "Test"}
              </button>
              <button
                className="btn secondary"
                onClick={() => {
                  clearMotionCache();
                  queryClient.removeQueries({ queryKey: ["motion"] });
                  toast("Animated artwork cache cleared");
                }}
              >
                Clear Cache
              </button>
            </div>
          </Row>
        </>
      )}
    </Group>
  );
}

export function SettingsPage() {
  const s = useSettings();
  const creds = useAuth((st) => st.creds);
  const serverInfo = useAuth((st) => st.serverInfo);
  const extensions = useAuth((st) => st.extensions);
  const signOut = useAuth((st) => st.signOut);
  const quality = QUALITY.find((q) => q.format === s.streamFormat && q.bitrate === s.maxBitRate) ?? QUALITY[0];

  return (
    <div className="page settings">
      <PageTitle>Settings</PageTitle>

      <Group title="Account">
        <Row label="Server" detail={serverInfo?.type ? `${serverInfo.type} ${serverInfo.version ?? ""}` : undefined}>
          <span className="settings-value">{creds?.server}</span>
        </Row>
        <Row label="Signed in as">
          <span className="settings-value">{creds?.username}</span>
        </Row>
        <Row label="Lyrics support" detail="OpenSubsonic songLyrics extension">
          <span className="settings-value">{extensions.includes("songLyrics") ? "Synced lyrics" : "Basic"}</span>
        </Row>
        <Row label="">
          <button
            className="btn danger-outline"
            onClick={async () => {
              const ok = await confirmAction({ title: "Sign out?", message: "Your queue and settings stay on this computer.", confirmLabel: "Sign Out" });
              if (!ok) return;
              engine.stop();
              usePlayer.setState({ playing: false });
              queryClient.clear();
              signOut();
            }}
          >
            Sign Out
          </button>
        </Row>
      </Group>

      <Group title="Playback">
        <Row label="Streaming quality" detail="Transcoding happens on your Navidrome server">
          <select
            className="select"
            value={QUALITY.indexOf(quality)}
            onChange={(e) => {
              const q = QUALITY[Number(e.target.value)];
              s.set({ streamFormat: q.format, maxBitRate: q.bitrate });
            }}
          >
            {QUALITY.map((q, i) => (
              <option key={i} value={i}>
                {q.label}
              </option>
            ))}
          </select>
        </Row>
        <Row label="Sound Check" detail="Even out loudness using ReplayGain tags">
          <Toggle label="Sound Check" checked={s.soundCheck} onChange={(v) => s.set({ soundCheck: v })} />
        </Row>
        <Row label="Autoplay" detail="Keep playing similar music when your queue ends">
          <Toggle label="Autoplay" checked={s.autoplay} onChange={(v) => s.set({ autoplay: v })} />
        </Row>
        <Row label="Scrobble plays" detail="Updates play counts and Last.fm / ListenBrainz via Navidrome">
          <Toggle label="Scrobble" checked={s.scrobble} onChange={(v) => s.set({ scrobble: v })} />
        </Row>
      </Group>

      <Group title="Lyrics">
        <Row label="Find missing lyrics on LRCLIB" detail="Synced lyrics from lrclib.net when Navidrome has none">
          <Toggle label="LRCLIB" checked={s.lrclib} onChange={(v) => s.set({ lrclib: v })} />
        </Row>
        <Row label="Blur surrounding lines" detail="In the full-screen player">
          <Toggle label="Blur lyrics" checked={s.lyricsBlur} onChange={(v) => s.set({ lyricsBlur: v })} />
        </Row>
      </Group>

      <Group title="Appearance">
        <Row label="Theme">
          <Segmented<ThemePref>
            value={s.theme}
            onChange={(v) => s.set({ theme: v })}
            options={[
              { value: "system", label: "Auto" },
              { value: "light", label: "Light" },
              { value: "dark", label: "Dark" },
            ]}
          />
        </Row>
        <Row label="Accent color">
          <div className="swatches">
            {ACCENTS.map((a) => (
              <button key={a.value} className={`swatch${s.accent === a.value ? " on" : ""}`} style={{ background: a.value }} title={a.name} aria-label={a.name} onClick={() => s.set({ accent: a.value })} />
            ))}
          </div>
        </Row>
        <Row
          label="Artwork quality"
          detail={
            (s.artworkQuality ?? "high") === "original"
              ? "Full-resolution files on album, playlist and artist pages and in the full-screen player; sharp 2× copies elsewhere"
              : (s.artworkQuality ?? "high") === "high"
                ? "Covers are loaded at twice their on-screen size so they stay sharp"
                : "Covers are loaded at their on-screen size (least data)"
          }
        >
          <Segmented<ArtworkQuality>
            value={s.artworkQuality ?? "high"}
            onChange={(v) => s.set({ artworkQuality: v })}
            options={[
              { value: "standard", label: "Standard" },
              { value: "high", label: "High" },
              { value: "original", label: "Original" },
            ]}
          />
        </Row>
        <Row label="Animated background" detail="Moving artwork colors behind the full-screen player">
          <Toggle label="Animated background" checked={s.animatedBackground} onChange={(v) => s.set({ animatedBackground: v })} />
        </Row>
      </Group>

      <MotionSettingsGroup />

      <Group title="Keyboard Shortcuts">
        {SHORTCUTS.map(([k, v]) => (
          <Row key={k} label={v}>
            <kbd>{k}</kbd>
          </Row>
        ))}
      </Group>

      <p className="settings-about">Cadence {__APP_VERSION__} · A Navidrome client</p>
    </div>
  );
}
