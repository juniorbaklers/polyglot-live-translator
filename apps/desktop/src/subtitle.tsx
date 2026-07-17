import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import "./subtitle.css";

interface Status { latestOriginal: string; latestTranslation: string; error?: string | null }

function SubtitleWindow() {
  const [status, setStatus] = useState<Status>({ latestOriginal: "", latestTranslation: "En attente de traduction…" });
  useEffect(() => {
    const timer = window.setInterval(() => invoke<Status>("get_browser_capture_status").then(setStatus).catch(() => undefined), 250);
    return () => window.clearInterval(timer);
  }, []);
  return <main data-tauri-drag-region>
    <div className="bar" data-tauri-drag-region>Polyglot Live — Sous-titres</div>
    {status.latestOriginal && <div className="original">{status.latestOriginal}</div>}
    <div className="translation">{status.latestTranslation || status.error || "En attente de traduction…"}</div>
  </main>;
}

ReactDOM.createRoot(document.getElementById("root")!).render(<React.StrictMode><SubtitleWindow /></React.StrictMode>);
