// Fenêtre de transcription isolée des styles de la page vidéo.
const ID = "polyglot-live-subtitles";
let panel: HTMLElement | null = null;
let root: ShadowRoot | null = null;
let hiddenByUser = false;
let bilingual = false;
let fontSize = 23;
let transcriptHistory: { original: string; translation: string; id?: string; revision: number; final: boolean; bounded?: boolean }[] = [];

function ensureOverlay() {
  if (panel?.isConnected) return panel;
  panel = document.createElement("div");
  panel.id = ID;
  Object.assign(panel.style, { position: "fixed", right: "24px", bottom: "24px", width: "min(760px,calc(100vw - 32px))", height: "min(480px,70vh)", minWidth: "280px", minHeight: "180px", maxWidth: "calc(100vw - 16px)", maxHeight: "calc(100vh - 16px)", zIndex: "2147483647", resize: "both", overflow: "hidden", borderRadius: "14px", boxShadow: "0 18px 60px #0007" });
  root = panel.attachShadow({ mode: "open" });
  root.innerHTML = `<style>
    :host{color-scheme:dark}*{box-sizing:border-box}button,select,input{font:inherit}button{cursor:pointer}button:focus-visible,select:focus-visible,input:focus-visible{outline:2px solid #aebfff;outline-offset:2px}
    .window{height:100%;display:flex;flex-direction:column;background:linear-gradient(140deg,#303030,#252525);color:#f4f4f4;font:14px/1.45 'Segoe UI',sans-serif}
    header{display:flex;align-items:center;gap:10px;padding:12px 14px;background:#202020;border-bottom:1px solid #ffffff12;cursor:move;flex-wrap:wrap;flex-shrink:0}
    .brand{font-weight:700;white-space:nowrap}.status{font-size:12px;color:#c5c5c5;flex:1;min-width:90px}.dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:#73c476;margin-right:6px}.status.stopped .dot{background:#888}
    button{border:1px solid #ffffff19;color:#b7b7b7;background:#272727;padding:6px 11px;border-radius:5px;font-weight:600}.stop{background:#683c3c;color:#fff;border-color:#a36666}.views{display:flex}.views button{border-radius:0}.views button:first-child{border-radius:5px 0 0 5px}.views button:last-child{border-radius:0 5px 5px 0}button[aria-pressed=true]{background:#38496c;color:#fff;border-color:#6b7fac}.icon{font-size:23px;border:0;background:transparent;padding:0 4px;line-height:1.1}
    .settings{padding:14px 18px;background:#242424;border-bottom:1px solid #ffffff14}.settings[hidden]{display:none}.settings label{display:block;margin-bottom:7px;color:#d3d3d3}.settings select{width:100%;padding:8px;background:#303030;color:#fff;border:1px solid #555;border-radius:6px;margin-bottom:12px}.settings input{width:100%}.note{font-size:12px;color:#aaa;margin:4px 0 0}
    .transcript{flex:1;overflow:auto;padding:12px 24px 24px;scrollbar-color:#5a5a5a transparent}.phrase{padding:18px 0;border-bottom:1px solid #ffffff0a}.translation{font-size:var(--text-size,23px);font-weight:600;line-height:1.55;overflow-wrap:anywhere;white-space:pre-wrap}.original{font-size:16px;color:#aaa;margin-bottom:7px;line-height:1.5;white-space:pre-wrap}.original[hidden]{display:none}.empty{padding-top:24px;color:#aaa;font-size:17px}.notice{padding:8px 18px;color:#ccc;font-size:12px;background:#202020}.notice:empty{display:none}
  </style><section class="window" aria-label="Traduction Polyglot Live">
    <header><span class="brand">Polyglot Live</span><span class="status"><span class="dot"></span><span data-status>Traduction en cours</span></span><button class="stop" data-stop>Arrêter</button><div class="views" aria-label="Affichage du texte"><button data-view="both" aria-pressed="false">Les deux</button><button data-view="translation" aria-pressed="true">Traduction</button></div><button class="icon" data-settings aria-label="Paramètres" aria-expanded="false">⚙</button><button class="icon" data-close aria-label="Masquer la fenêtre">×</button></header>
    <div class="settings" hidden><label for="output-mode">Mode de traduction</label><select id="output-mode"><option value="subtitles">Sous-titres traduits</option><option value="voice">Voix traduite</option><option value="both">Sous-titres + voix traduite</option></select><label for="text-size">Taille du texte</label><input id="text-size" type="range" min="16" max="36" value="23"><p class="note">« Les deux » affiche le texte original et sa traduction. La voix conserve le son original. Le moteur local gratuit doit être lancé avec DEMARRER.cmd. Aucun service payant n’est utilisé.</p></div>
    <div class="notice" role="status"></div><div class="transcript" role="log" aria-label="Historique des traductions"><div class="empty">Les phrases traduites apparaîtront ici.</div></div>
  </section>`;
  document.documentElement.appendChild(panel);
  root.querySelector<HTMLButtonElement>('[data-close]')!.onclick = () => { hiddenByUser = true; panel!.style.display = "none"; };
  root.querySelector<HTMLButtonElement>('[data-settings]')!.onclick = (event) => {
    const settings = root!.querySelector<HTMLElement>('.settings')!;
    settings.hidden = !settings.hidden;
    (event.currentTarget as HTMLElement).setAttribute("aria-expanded", String(!settings.hidden));
  };
  root.querySelectorAll<HTMLButtonElement>('[data-view]').forEach((button) => {
    button.onclick = () => { bilingual = button.dataset.view === "both"; renderHistory(); chrome.storage.local.set({ overlayBilingual: bilingual }).catch(() => undefined); };
  });
  root.querySelector<HTMLInputElement>('#text-size')!.oninput = (event) => {
    fontSize = Number((event.target as HTMLInputElement).value);
    panel!.style.setProperty("--text-size", `${fontSize}px`);
    chrome.storage.local.set({ overlayFontSize: fontSize }).catch(() => undefined);
  };
  root.querySelector<HTMLSelectElement>('#output-mode')!.onchange = async (event) => {
    try {
      const response = await chrome.runtime.sendMessage({ type: "output.change", outputMode: (event.target as HTMLSelectElement).value });
      setNotice(response?.ok ? "Mode appliqué aux prochaines traductions." : response?.error ?? "Modification impossible.");
    } catch { setNotice("Connexion à l’extension interrompue."); }
  };
  root.querySelector<HTMLButtonElement>('[data-stop]')!.onclick = async () => {
    try {
      const response = await chrome.runtime.sendMessage({ type: "capture.stop" });
      if (!response?.ok) setNotice(response?.error ?? "Impossible d’arrêter la capture.");
    } catch { setNotice("Connexion à l’extension interrompue."); }
  };
  makeDraggable(panel, root.querySelector<HTMLElement>('header')!);
  const currentRoot = root;
  chrome.storage.local.get(["outputMode", "overlayBilingual", "overlayFontSize"]).then((settings) => {
    if (root !== currentRoot) return;
    bilingual = settings.overlayBilingual === true;
    fontSize = Math.max(16, Math.min(36, Number(settings.overlayFontSize) || 23));
    panel!.style.setProperty("--text-size", `${fontSize}px`);
    currentRoot.querySelector<HTMLInputElement>('#text-size')!.value = String(fontSize);
    currentRoot.querySelector<HTMLSelectElement>('#output-mode')!.value = settings.outputMode ?? "subtitles";
    renderHistory();
  }).catch(() => undefined);
  renderHistory();
  return panel;
}

function setNotice(text: string) { if (root) root.querySelector<HTMLElement>('.notice')!.textContent = text; }

function renderHistory() {
  if (!root) return;
  const log = root.querySelector<HTMLElement>('.transcript')!;
  const previousScroll = log.scrollTop;
  const atBottom = log.scrollHeight - log.clientHeight - log.scrollTop < 60;
  log.replaceChildren();
  if (!transcriptHistory.length) { const empty = document.createElement('div'); empty.className = 'empty'; empty.textContent = 'Les phrases traduites apparaîtront ici.'; log.appendChild(empty); }
  for (const item of transcriptHistory) {
    const row = document.createElement('div'); row.className = 'phrase';
    const original = document.createElement('div'); original.className = 'original'; original.textContent = item.original; original.hidden = !bilingual && Boolean(item.translation);
    const translation = document.createElement('div'); translation.className = 'translation'; translation.textContent = item.translation || 'Traduction indisponible pour cet extrait.';
    row.append(original, translation); log.appendChild(row);
    if (!item.final || item.bounded) {
      const label = document.createElement('div'); label.className = 'note';
      label.textContent = !item.final ? 'En cours — le texte peut être corrigé.' : 'Fin de phrase non confirmée.';
      row.appendChild(label);
    }
  }
  root.querySelectorAll<HTMLElement>('[data-view]').forEach((button) => button.setAttribute('aria-pressed', String((button.dataset.view === 'both') === bilingual)));
  log.scrollTop = atBottom ? log.scrollHeight : previousScroll;
}

function makeDraggable(element: HTMLElement, handle: HTMLElement) {
  let pointerId: number | null = null, offsetX = 0, offsetY = 0;
  handle.addEventListener('pointerdown', (event) => {
    if ((event.target as Element).closest('button,select,input') || event.button !== 0) return;
    const rect = element.getBoundingClientRect(); offsetX = event.clientX - rect.left; offsetY = event.clientY - rect.top;
    pointerId = event.pointerId; handle.setPointerCapture(pointerId); event.preventDefault();
  });
  handle.addEventListener('pointermove', (event) => {
    if (event.pointerId !== pointerId) return;
    element.style.left = `${Math.max(0, Math.min(innerWidth - element.offsetWidth, event.clientX - offsetX))}px`;
    element.style.top = `${Math.max(0, Math.min(innerHeight - element.offsetHeight, event.clientY - offsetY))}px`;
    element.style.right = element.style.bottom = 'auto';
  });
  const release = () => { pointerId = null; };
  handle.addEventListener('pointerup', release); handle.addEventListener('pointercancel', release);
}

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'overlay.show') {
    if (String(message.text).startsWith('Connexion ')) { transcriptHistory = []; hiddenByUser = false; }
    ensureOverlay();
    renderHistory();
    if (!hiddenByUser) panel!.style.display = 'block';
    root!.querySelector<HTMLElement>('[data-status]')!.textContent = 'Traduction en cours';
    root!.querySelector<HTMLElement>('.status')!.classList.remove('stopped');
    root!.querySelector<HTMLButtonElement>('[data-stop]')!.disabled = false;
    setNotice(message.text);
  }
  if (message.type === 'overlay.subtitle') {
    const original = String(message.original ?? '').trim();
    const translation = String(message.translation ?? '').trim();
    if (!original && !translation) return;
    ensureOverlay();
    if (!hiddenByUser) panel!.style.display = 'block';
    const id = typeof message.id === 'string' ? message.id : undefined;
    const revision = Number(message.revision) || 0;
    const existing = id ? transcriptHistory.findIndex((item) => item.id === id) : -1;
    const item = { original, translation, id, revision, final: message.final !== false, bounded: message.bounded === true };
    if (existing >= 0) {
      if (transcriptHistory[existing].final || revision <= transcriptHistory[existing].revision) return;
      transcriptHistory[existing] = item;
    } else transcriptHistory.push(item);
    if (transcriptHistory.length > 150) transcriptHistory.shift();
    setNotice(''); renderHistory();
  }
  if (message.type === 'overlay.hide') { if (panel) panel.style.display = 'none'; }
  if (message.type === 'overlay.mode' && root) {
    root.querySelector<HTMLSelectElement>('#output-mode')!.value = message.outputMode;
    if (message.outputMode === 'voice') panel!.style.display = 'none';
    else if (!hiddenByUser) panel!.style.display = 'block';
  }
  if ((message.type === 'overlay.stopped' || message.type === 'overlay.error') && root) {
    transcriptHistory.forEach((item) => { if (!item.final) { item.final = true; item.bounded = true; } });
    renderHistory();
    root.querySelector<HTMLElement>('[data-status]')!.textContent = 'Traduction arrêtée';
    root.querySelector<HTMLElement>('.status')!.classList.add('stopped');
    root.querySelector<HTMLButtonElement>('[data-stop]')!.disabled = true;
    setNotice(message.type === 'overlay.error' ? message.text : 'Capture arrêtée. L’historique reste consultable.');
  }
});
