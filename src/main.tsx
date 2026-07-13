import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import * as ipc from "@/lib/ipc";
import { applyTheme, resolveTheme, sanitizeCustomThemes } from "@/lib/themes";
import "./globals.css";

// Disable the webview's native context menu app-wide (it reads as a stray
// browser menu — Inspect/Reload — in a desktop app). A proper app-style
// context menu can replace this later; for now right-click just does nothing.
document.addEventListener("contextmenu", (e) => e.preventDefault());

function render() {
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

// Apply the saved theme before first paint so non-default themes don't flash
// the Default palette (globals.css :root ships the Default values). One local
// file read — cheap. Any failure falls back to rendering with Default.
ipc.loadSettings()
  .then((settings) => {
    applyTheme(resolveTheme(settings.selectedThemeId, sanitizeCustomThemes(settings.customThemes)));
  })
  .catch(() => {})
  .finally(render);
