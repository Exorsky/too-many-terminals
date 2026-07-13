import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./globals.css";

// Disable the webview's native context menu app-wide (it reads as a stray
// browser menu — Inspect/Reload — in a desktop app). A proper app-style
// context menu can replace this later; for now right-click just does nothing.
document.addEventListener("contextmenu", (e) => e.preventDefault());

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
