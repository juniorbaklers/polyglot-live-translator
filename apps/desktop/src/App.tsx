import { useEffect, useMemo, useState } from "react";
import { audioApi, type AudioDevice, type AudioMeter, type CaptureSource } from "./audio";
import { invoke } from "@tauri-apps/api/core";
import "./extra.css";
import { AcademicFeatures } from "./AcademicFeatures";
import { Onboarding } from "./Onboarding";

const menu = [
  ["CONFIGURATION", "Compte", "Entrée audio", "Langues"],
  ["SORTIE", "Sous-titres", "Sortie vocale", "Partage en direct"],
  ["RESSOURCES", "Terminologie", "Transcriptions", "Résumés et fiches"],
  ["SUPPORT", "Retours", "Support technique", "À propos"]
];

export function App() {
  const [running, setRunning] = useState(false);
  const [source, setSource] = useState<CaptureSource>("system-audio");
  const [devices, setDevices] = useState<AudioDevice[]>([]);
  const [meter, setMeter] = useState<AudioMeter>({ active: false, level: 0, peak: 0, signalDetected: false, elapsedMs: 0 });
  const [audioMessage, setAudioMessage] = useState("Prêt à tester le son");
  const fallbackPairingCode = useMemo(() => String(Math.floor(100000 + Math.random() * 900000)), []);
  const [pairingCode, setPairingCode] = useState(fallbackPairingCode);
  const [browserStatus, setBrowserStatus] = useState("Extension non connectée");
  const [apiKey, setApiKey] = useState("");
  const [apiKeyReady, setApiKeyReady] = useState(false);
  const [sessions, setSessions] = useState<Array<{ id: number; title: string; segmentCount: number }>>([]);
  const [demoMode, setDemoMode] = useState(false);

  useEffect(() => {
    audioApi.listDevices().then(setDevices).catch(() => setDevices([
      { id: "default-render", label: "Sortie Windows par défaut", kind: "output", isDefault: true },
      { id: "default-capture", label: "Microphone Windows par défaut", kind: "input", isDefault: true }
    ]));
  }, []);

  useEffect(() => {
    invoke<boolean>("has_api_key").then(setApiKeyReady).catch(() => undefined);
    invoke<boolean>("get_demo_mode").then(setDemoMode).catch(() => undefined);
    invoke<Array<{ id: number; title: string; segmentCount: number }>>("list_sessions").then(setSessions).catch(() => undefined);
  }, []);

  async function storeApiKey() {
    try { await invoke("save_api_key", { value: apiKey }); setApiKey(""); setApiKeyReady(true); }
    catch (error) { setAudioMessage(String(error)); }
  }

  async function toggleDemoMode() {
    const enabled = !demoMode;
    await invoke("set_demo_mode", { enabled });
    setDemoMode(enabled);
  }

  useEffect(() => {
    invoke<string>("get_pairing_code").then(setPairingCode).catch(() => undefined);
    const timer = window.setInterval(() => {
      invoke<{ connected: boolean; capturing: boolean; chunksReceived: number }>("get_browser_capture_status")
        .then((status) => setBrowserStatus(
          status.capturing
            ? `Capture navigateur en cours — ${status.chunksReceived} segments reçus`
            : status.connected ? "Extension connectée" : "Extension non connectée"
        ))
        .catch(() => undefined);
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => {
      audioApi.meter().then((value) => {
        setMeter(value);
        if (value.error) setAudioMessage(value.error);
        else if (value.elapsedMs > 3000 && !value.signalDetected) setAudioMessage("Aucun son détecté — vérifiez le périphérique et le volume");
        else setAudioMessage(value.signalDetected ? "Signal audio détecté" : "Écoute en cours…");
      }).catch(() => setAudioMessage("Le test natif sera disponible dans l’application Windows"));
    }, 100);
    return () => window.clearInterval(timer);
  }, [running]);

  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if (!event.ctrlKey || !event.shiftKey) return;
      if (event.code === "KeyH") { event.preventDefault(); invoke("open_subtitle_window"); }
      if (event.code === "Space") { event.preventDefault(); toggleCapture(); }
    };
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  });

  async function toggleCapture() {
    try {
      if (running) {
        await audioApi.stop();
        setRunning(false);
        setAudioMessage("Test audio arrêté");
      } else {
        setMeter({ active: true, level: 0, peak: 0, signalDetected: false, elapsedMs: 0 });
        await audioApi.start(source);
        setRunning(true);
        setAudioMessage("Écoute en cours…");
      }
    } catch (error) {
      setRunning(false);
      setAudioMessage(String(error));
    }
  }

  return <div className="shell">
    <Onboarding />
    <aside>
      <div className="brand"><span>PL</span><b>Polyglot Live</b></div>
      {menu.map(([title, ...items]) => <section key={title}>
        <small>{title}</small>
        {items.map((item, index) => <button className={title === "CONFIGURATION" && index === 1 ? "active" : ""} key={item}>{item}</button>)}
      </section>)}
    </aside>
    <main>
      <header><div><h1>Entrée audio</h1><p>Choisissez la source que vous souhaitez traduire.</p></div><span className="status">● Application prête</span></header>
      <div className="tabs"><button className="selected">Basique</button><button>Avancé</button></div>
      <div className="cards">
        <article className={source === "system-audio" ? "chosen" : ""} onClick={() => !running && setSource("system-audio")}><h3>Son de l’ordinateur</h3><p>Traduire une vidéo, un cours ou toute autre application avec WASAPI Loopback.</p><strong>{source === "system-audio" ? "Sélectionné" : "Choisir"}</strong></article>
        <article className={source === "microphone" ? "chosen" : ""} onClick={() => !running && setSource("microphone")}><h3>Microphone</h3><p>Traduire votre voix ou une conversation proche.</p><strong>{source === "microphone" ? "Sélectionné" : "Choisir"}</strong></article>
        <article><h3>Onglet du navigateur</h3><p>Utiliser l’extension Chrome ou Edge.</p><strong>Choisir</strong></article>
        <article><h3>Importer un fichier</h3><p>Audio ou vidéo auquel vous avez légalement accès.</p><strong>Choisir</strong></article>
      </div>
      <section className="audio-test">
        <div className="audio-test-head"><div><h2>Test du son</h2><p>{audioMessage}</p></div><button onClick={toggleCapture}>{running ? "Arrêter le test" : "Tester le son"}</button></div>
        <label>Périphérique
          <select disabled={running}>
            {devices.filter((device) => source === "microphone" ? device.kind === "input" : device.kind === "output").map((device) => <option key={device.id}>{device.label}</option>)}
          </select>
        </label>
        <div className="meter" role="meter" aria-valuenow={Math.round(meter.level * 100)} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${Math.min(100, meter.level * 180)}%` }} /></div>
        <div className="meter-scale"><span>Silence</span><span>{Math.round(meter.level * 100)} %</span><span>Fort</span></div>
      </section>
      <section className="pairing"><div><h2>Association de l’extension</h2><p>{browserStatus}. Saisissez ce code dans l’extension.</p></div><code>{pairingCode}</code></section>
      <button className="floating-subtitle-button" onClick={() => invoke("open_subtitle_window")}>Ouvrir la fenêtre flottante de sous-titres</button>
      <section className="security-panel">
        <div><h2>Service de transcription</h2><p>{apiKeyReady ? "Clé protégée dans le coffre Windows" : "Ajoutez votre clé uniquement ici — jamais dans GitHub"}</p></div>
        {!apiKeyReady && <><input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="Clé API" autoComplete="off"/><button onClick={storeApiKey}>Enregistrer en sécurité</button></>}
        <button className={demoMode ? "demo-active" : ""} onClick={toggleDemoMode}>{demoMode ? "Mode démo actif" : "Activer la démo"}</button>
      </section>
      <section className="sessions-panel"><h2>Transcriptions récentes</h2>{sessions.length ? sessions.slice(0,5).map((session) => <div key={session.id}><span>{session.title}</span><strong>{session.segmentCount} segments</strong></div>) : <p>Aucune transcription enregistrée.</p>}</section>
      <AcademicFeatures />
      <section className="controls">
        <select aria-label="Langue source"><option>Détection automatique</option><option>Français</option><option>Anglais</option></select>
        <span>→</span>
        <select aria-label="Langue cible"><option>Français</option><option>Anglais</option><option>Espagnol</option></select>
        <button className={running ? "stop" : "start"} onClick={toggleCapture}>{running ? "Arrêter" : "Démarrer"}</button>
      </section>
    </main>
  </div>;
}
