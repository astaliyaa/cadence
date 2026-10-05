import { useEffect, useState } from "react";
import { isTauri } from "../lib/platform";

/** Windows-style caption buttons for the frameless window. */
export function WindowControls() {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!isTauri) return;
    let unlisten: (() => void) | undefined;
    (async () => {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      const win = getCurrentWindow();
      setMaximized(await win.isMaximized());
      unlisten = await win.onResized(async () => setMaximized(await win.isMaximized()));
    })();
    return () => unlisten?.();
  }, []);

  const act = async (what: "min" | "max" | "close") => {
    if (!isTauri) return;
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const win = getCurrentWindow();
    if (what === "min") win.minimize();
    else if (what === "max") win.toggleMaximize();
    else win.close();
  };

  return (
    <div className="window-controls">
      <button aria-label="Minimize" onClick={() => act("min")}>
        <span>&#xE921;</span>
      </button>
      <button aria-label={maximized ? "Restore" : "Maximize"} onClick={() => act("max")}>
        <span>{maximized ? "" : ""}</span>
      </button>
      <button aria-label="Close" className="close" onClick={() => act("close")}>
        <span>&#xE8BB;</span>
      </button>
    </div>
  );
}
