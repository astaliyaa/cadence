export const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
export const isMac = /Mac OS X|Macintosh/.test(ua);
export const isWindows = /Windows/.test(ua);

export async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri) throw new Error(`"${cmd}" needs the desktop app`);
  const core = await import("@tauri-apps/api/core");
  return core.invoke<T>(cmd, args);
}

/** Fire-and-forget native call; silently ignored in a plain browser. */
export function invokeQuiet(cmd: string, args?: Record<string, unknown>) {
  if (!isTauri) return;
  invoke(cmd, args).catch(() => {});
}

/** Writes to the desktop app's terminal log (development builds only). */
export function debugLog(message: string) {
  if (import.meta.env.DEV) invokeQuiet("debug_log", { message });
}

/**
 * Routes a third-party URL through the app's `proxy://` protocol so the webview
 * can read it without CORS headaches. In a plain browser the URL is returned as-is.
 */
export function proxyUrl(url: string): string {
  if (!isTauri) return url;
  const q = `?u=${encodeURIComponent(url)}`;
  return isWindows ? `http://proxy.localhost/${q}` : `proxy://localhost/${q}`;
}

export async function openExternal(url: string) {
  if (isTauri) {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(url);
  } else {
    window.open(url, "_blank", "noopener");
  }
}

export interface PlatformInfo {
  os: string;
  vibrancy: boolean;
}

export async function platformInfo(): Promise<PlatformInfo> {
  if (!isTauri) return { os: "web", vibrancy: false };
  try {
    return await invoke<PlatformInfo>("platform_info");
  } catch {
    return { os: "unknown", vibrancy: false };
  }
}
