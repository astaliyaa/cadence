import { useState } from "react";
import { Subsonic, SubsonicError } from "../api/subsonic";
import { useAuth } from "../store/auth";
import { isWindows } from "../lib/platform";
import { WindowControls } from "../components/WindowControls";

export function Login() {
  const signIn = useAuth((s) => s.signIn);
  const [server, setServer] = useState(() => localStorage.getItem("cadence.lastServer") ?? "");
  const [username, setUsername] = useState(() => localStorage.getItem("cadence.lastUser") ?? "");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { client, server: info } = await Subsonic.signIn(server, username, password);
      localStorage.setItem("cadence.lastServer", server);
      localStorage.setItem("cadence.lastUser", username);
      signIn(client, info);
    } catch (err) {
      const msg = err instanceof SubsonicError ? err.message : "Couldn't sign in.";
      setError(err instanceof SubsonicError && err.code === 40 ? "Wrong username or password." : msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login">
      <div className="login-drag" data-tauri-drag-region />
      {isWindows && <WindowControls />}
      <div className="login-glow" />
      <form className="login-card" onSubmit={submit}>
        <img src="/icon.svg" alt="" className="login-icon" draggable={false} />
        <h1>Sign in to Navidrome</h1>
        <p className="login-sub">Connect Cadence to your music server.</p>
        <label>
          <span>Server</span>
          <input className="text-field" value={server} onChange={(e) => setServer(e.target.value)} placeholder="https://music.example.com" autoFocus={!server} spellCheck={false} autoCapitalize="off" />
        </label>
        <label>
          <span>Username</span>
          <input className="text-field" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" spellCheck={false} autoCapitalize="off" />
        </label>
        <label>
          <span>Password</span>
          <input className="text-field" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" autoFocus={!!server} />
        </label>
        {error && <div className="login-error">{error}</div>}
        <button className="btn primary wide" disabled={busy || !server || !username}>
          {busy ? "Signing In…" : "Sign In"}
        </button>
        <p className="login-note">Your password is never stored — only a salted token, like other Subsonic clients.</p>
      </form>
    </div>
  );
}
