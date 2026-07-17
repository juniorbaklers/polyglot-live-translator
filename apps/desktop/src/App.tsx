import { useMemo, useState } from "react";

const menu = [
  ["CONFIGURATION", "Compte", "Entrée audio", "Langues"],
  ["SORTIE", "Sous-titres", "Sortie vocale", "Partage en direct"],
  ["RESSOURCES", "Terminologie", "Transcriptions", "Résumés et fiches"],
  ["SUPPORT", "Retours", "Support technique", "À propos"]
];

export function App() {
  const [running, setRunning] = useState(false);
  const pairingCode = useMemo(() => String(Math.floor(100000 + Math.random() * 900000)), []);

  return <div className="shell">
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
        <article className="chosen"><h3>Son de l’ordinateur</h3><p>Traduire une vidéo, un cours ou toute autre application.</p><strong>Sélectionné</strong></article>
        <article><h3>Microphone</h3><p>Traduire votre voix ou une conversation proche.</p><strong>Choisir</strong></article>
        <article><h3>Onglet du navigateur</h3><p>Utiliser l’extension Chrome ou Edge.</p><strong>Choisir</strong></article>
        <article><h3>Importer un fichier</h3><p>Audio ou vidéo auquel vous avez légalement accès.</p><strong>Choisir</strong></article>
      </div>
      <section className="pairing"><div><h2>Association de l’extension</h2><p>Saisissez ce code dans l’extension. Il est temporaire et à usage unique.</p></div><code>{pairingCode}</code></section>
      <section className="controls">
        <select aria-label="Langue source"><option>Détection automatique</option><option>Français</option><option>Anglais</option></select>
        <span>→</span>
        <select aria-label="Langue cible"><option>Français</option><option>Anglais</option><option>Espagnol</option></select>
        <button className={running ? "stop" : "start"} onClick={() => setRunning(!running)}>{running ? "Arrêter" : "Démarrer"}</button>
      </section>
    </main>
  </div>;
}
