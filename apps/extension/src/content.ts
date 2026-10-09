import { generateStudyAid, normalizeAnswer } from "./study";
(() => {
const scope = globalThis as typeof globalThis & { __polyglotContentVersion?: string };
if (scope.__polyglotContentVersion === "1.18.0") return;
scope.__polyglotContentVersion = "1.18.0";
// Fenêtre de transcription isolée des styles de la page vidéo.
const ID = "polyglot-live-subtitles";
let panel: HTMLElement | null = null;
let root: ShadowRoot | null = null;
let hiddenByUser = false;
let bilingual = false;
let fontSize = 23;
let sizeChangedByUser = false;
let finalOnly = true;
let readingModeChangedByUser = false;
interface TranscriptRow { original: string; translation: string; id?: string; revision: number; final: boolean; bounded?: boolean; start?: number; end?: number; timing?: string; origin?: string; uncertainWords?: string[]; sourceLanguage?: string; targetLanguage?: string; corrected?: boolean; recognizedOriginal?: string; }
let transcriptHistory: TranscriptRow[] = [];
// Fin fixe pendant la relecture : les nouvelles phrases ne déplacent pas la page.
let historyEnd: number | null = null;
const renderedRows = new Map<TranscriptRow, {signature: string; row: HTMLElement}>();
let sessionActive = false;
let documentOriginal: string | undefined;
let documentTranslation: string | undefined;
let studyExportText = "";
let stopCaptions: (() => void) | undefined;
let archiveWrites = Promise.resolve();
function saveArchive() {
  const rows = transcriptHistory.filter(item => item.final).map(item => ({...item}));
  if (!rows.length) return;
  const archive = {version: 1, savedAt: Date.now(), rows, documentOriginal, documentTranslation};
  archiveWrites = archiveWrites.then(() => chrome.storage.local.set({transcriptArchive: archive})).catch(() => {
    setNotice("Sauvegarde locale impossible. Exportez la transcription avant de fermer la page.");
  });
}

function ensureOverlay() {
  if (panel?.isConnected) return panel;
  panel = document.createElement("div");
  panel.id = ID;
  Object.assign(panel.style, { position: "fixed", right: "24px", bottom: "24px", width: "min(760px,calc(100vw - 32px))", height: "min(480px,70vh)", minWidth: "280px", minHeight: "180px", maxWidth: "calc(100vw - 16px)", maxHeight: "calc(100vh - 16px)", zIndex: "2147483647", resize: "both", overflow: "hidden", borderRadius: "18px", boxShadow: "0 24px 80px #0009", border: "1px solid #7388b044" });
  root = panel.attachShadow({ mode: "open" });
  root.innerHTML = `<style>
    :host{color-scheme:dark}*{box-sizing:border-box}button,select,input{font:inherit}button{cursor:pointer}button:focus-visible,select:focus-visible,input:focus-visible{outline:2px solid #aebfff;outline-offset:2px}
    .window{height:100%;display:flex;flex-direction:column;background:linear-gradient(145deg,#152238,#0d1729);color:#eef3ff;font:14px/1.45 'Segoe UI',sans-serif}
    .resize-grip{position:absolute;right:0;bottom:0;width:26px;height:26px;z-index:4;cursor:nwse-resize;touch-action:none;border:0;border-radius:8px 0 0 0;background:linear-gradient(135deg,transparent 45%,#8fa8d4 47%,#8fa8d4 52%,transparent 54%,transparent 64%,#8fa8d4 66%,#8fa8d4 71%,transparent 73%)}
    :host([data-compact]) header{padding:6px 10px;gap:6px}:host([data-compact]) .brand{font-size:0}:host([data-compact]) .brand:before{margin-right:0}:host([data-compact]) .status,:host([data-compact]) .metrics,:host([data-compact]) [data-history-status],:host([data-compact]) [data-document-count]{display:none}
    :host([data-compact]) .history-controls{padding:5px 10px;gap:5px;flex-wrap:nowrap}:host([data-compact]) .history-controls button{font-size:11px;padding:5px 6px;white-space:nowrap}:host([data-compact]) .document-access{padding:5px 10px}:host([data-compact]) .transcript{padding:8px 10px 26px}:host([data-compact]) .phrase{padding:9px 10px;margin-bottom:7px}:host([data-compact]) .phrase-head{margin-bottom:5px}:host([data-compact]) .notice{padding:4px 10px;max-height:40px;overflow:auto}:host([data-compact]) .settings{max-height:30%;padding:6px 10px}
    header{display:flex;align-items:center;gap:10px;padding:14px 18px;background:#101d32;border-bottom:1px solid #ffffff12;cursor:move;flex-wrap:wrap;flex-shrink:0}
    .brand{font-weight:700;white-space:nowrap;letter-spacing:-.2px}.brand:before{content:"P";display:inline-grid;place-items:center;background:#5876ef;color:white;width:27px;height:27px;border-radius:8px;margin-right:9px;font-size:17px}.status{font-size:12px;color:#b1c0da;flex:1;min-width:90px}.dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:#75d8bc;box-shadow:0 0 0 4px #75d8bc15;margin-right:6px}.status.stopped .dot{background:#888}
    button{border:1px solid #ffffff19;color:#cfdbef;background:#213450;padding:6px 11px;border-radius:5px;font-weight:600}.stop{background:#683343;color:#fff;border-color:#a36666}.views{display:flex}.views button{border-radius:0}.views button:first-child{border-radius:5px 0 0 5px}.views button:last-child{border-radius:0 5px 5px 0}button[aria-pressed=true]{background:#3e57a3;color:#fff;border-color:#6b7fac}.icon{font-size:23px;border:0;background:transparent;padding:0 4px;line-height:1.1}
    .settings{padding:14px 18px;background:#132238;border-bottom:1px solid #ffffff14}.settings[hidden]{display:none}.settings label{display:block;margin-bottom:7px;color:#d3d3d3}.settings select{width:100%;padding:8px;background:#1b2e49;color:#fff;border:1px solid #555;border-radius:6px;margin-bottom:12px}.settings input{width:100%}.settings{max-height:45%;overflow:auto}textarea{width:100%;padding:8px;background:#1b2e49;color:#fff;border:1px solid #666;border-radius:6px}mark{background:#725a20;color:#fff}.tools{display:flex;gap:8px;margin-top:10px;flex-wrap:wrap}.metrics{color:#91a7ca;font-size:11px;padding:8px 18px;background:#101d32}.editor{margin-top:10px}.note{font-size:12px;color:#aaa;margin:4px 0 0}
    .document-access{display:flex;align-items:center;gap:10px;padding:10px 18px;background:#101d32;border-top:1px solid #ffffff12;flex-shrink:0}.document-access span{font-size:11px;color:#a5b9da}.document{position:absolute;inset:0;z-index:2;padding:16px;background:#101d32;display:flex;flex-direction:column;gap:7px;overflow:auto}.document[hidden]{display:none}.document-title,.document-export{display:flex;align-items:center;gap:8px;justify-content:space-between}.document label{font-size:12px;color:#b9c9e7}.document textarea{flex:1;min-height:70px;resize:none;font:14px/1.5 'Segoe UI',sans-serif}.document select{min-width:0;flex:1;padding:7px;background:#1b2e49;color:white;border:1px solid #61739255;border-radius:6px}.document textarea:focus-visible{outline:2px solid #aebfff}.document-title strong{font-size:16px}.study{border:1px solid #7992c34d;border-radius:8px;padding:9px}.study summary{cursor:pointer;color:#d5e2ff;font-weight:600}.study-result{font-size:14px;line-height:1.5}.study-result p{white-space:pre-wrap;overflow-wrap:anywhere}.study-result input{width:100%;padding:7px;border:1px solid #61739255;background:#1b2e49;color:white;border-radius:6px}.study-result article{border-top:1px solid #ffffff19;margin-top:12px;padding-top:9px}.study-result details{margin:7px 0}.study-result button{margin-top:6px}
    .history-controls{display:flex;align-items:center;gap:8px;padding:7px 18px;background:#101d32;flex-shrink:0;flex-wrap:wrap}.history-controls span{font-size:11px;color:#a5b9da}.history-controls button:disabled{opacity:.5;cursor:default}.transcript{flex:1;min-height:0;overflow:auto;padding:16px 20px 24px;scrollbar-color:#435d83 transparent}.phrase{padding:17px 19px;margin-bottom:12px;border:1px solid #91a6cd20;border-radius:13px;background:#1c2b434d}.phrase[data-pending=true]{border-left:3px solid #90a7ff}.phrase-head{display:flex;align-items:center;gap:8px;margin-bottom:9px;font-size:10px;color:#95aace;letter-spacing:.3px}.state-label{margin-left:auto;background:#284537;color:#a9e8c6;padding:3px 8px;border-radius:20px}.state-label.review{background:#4d4127;color:#ffdb9f}.phrase .tools{opacity:.7}.phrase:hover .tools,.phrase:focus-within .tools{opacity:1}.translation{font-size:var(--text-size,23px);font-weight:500;line-height:1.6;overflow-wrap:anywhere;white-space:pre-wrap}.original{font-size:16px;color:#adbedb;margin-bottom:9px;line-height:1.5;white-space:pre-wrap}.original[hidden]{display:none}.empty{padding-top:24px;color:#aaa;font-size:17px}.notice{padding:8px 18px;color:#c9d9f3;font-size:12px;background:#192b44}.notice:empty{display:none}
  </style><section class="window" aria-label="Traduction Polyglot Live">
    <header><span class="brand">Polyglot Live</span><span class="status"><span class="dot"></span><span data-status>Traduction en cours</span></span><button class="stop" data-stop>Arrêter</button><div class="views" aria-label="Affichage du texte"><button data-view="both" aria-pressed="false">Les deux</button><button data-view="translation" aria-pressed="true">Traduction</button></div><button data-size="smaller" aria-label="Réduire la fenêtre" title="Réduire la fenêtre">−</button><button data-size="larger" aria-label="Agrandir la fenêtre" title="Agrandir la fenêtre">+</button><button class="icon" data-settings aria-label="Paramètres" aria-expanded="false">⚙</button><button class="icon" data-close aria-label="Masquer la fenêtre">×</button></header>
    <div class="settings" hidden><label for="output-mode">Mode de traduction</label><select id="output-mode"><option value="subtitles">Sous-titres traduits</option><option value="voice">Voix traduite</option><option value="both">Sous-titres + voix traduite</option></select><label for="reading-mode">Lecture</label><select id="reading-mode"><option value="final">Phrases finalisées uniquement</option><option value="progressive">Texte provisoire puis finalisé</option></select><p class="note">Les phrases finalisées apparaissent après leur traitement. L’affichage attend davantage, mais le texte reste stable. Finalisé ne signifie pas sans erreur.</p><label for="text-size">Taille du texte</label><input id="text-size" type="range" min="16" max="36" value="23"><div class="tools"><button data-export="txt">Exporter TXT</button><button data-export="srt">Exporter SRT</button></div><p class="note">Export de toutes les phrases finalisées de cette session. Audio : temps relatifs au début de la capture ; sous-titres : temps de la vidéo.</p><p class="note">« Les deux » affiche le texte original et sa traduction. La voix conserve le son original. Le moteur local gratuit doit être lancé, automatiquement ou avec DEMARRER.cmd. Aucun service payant n’est utilisé.</p></div>
    <div class="metrics">Temps de traitement : en attente</div><div class="notice" role="status"></div><div class="history-controls"><button data-history-previous>Lignes précédentes</button><button data-history-live disabled>Revenir au direct</button><span data-history-status>Suivi en direct</span></div><div class="transcript" role="log" aria-label="Historique des traductions"><div class="empty">Les phrases traduites apparaîtront ici.</div></div>
    <div class="document-access"><button data-document>Transcription complète et export</button><button data-restore title="Ouvrir la dernière transcription sauvegardée">Dernière session</button><span data-document-count>0 phrase finalisée</span></div>
    <section class="document" hidden aria-label="Transcription complète"><div class="document-title"><strong>Transcription complète</strong><button data-document-close>Retour à la vidéo</button></div><p class="note" data-document-note></p><label for="document-original">Texte original</label><textarea id="document-original" spellcheck="true"></textarea><label for="document-translation">Traduction</label><textarea id="document-translation" spellcheck="true"></textarea><details class="study"><summary>Résumé et quiz gratuits</summary><p class="note">Après arrêt et relecture, choisissez le texte à étudier. Le résumé sélectionne des phrases du document ; le quiz propose des extraits à compléter. Aucun service externe.</p><div class="document-export"><select id="study-source" aria-label="Texte à étudier"><option value="translation">Traduction relue</option><option value="original">Texte original relu</option></select><button data-study="summary">Résumé</button><button data-study="quiz">Quiz</button></div><div class="study-result" aria-live="polite"></div><button data-study-export hidden>Exporter la fiche TXT</button></details><div class="document-export"><select aria-label="Format d’export" id="document-format"><option value="translation">Traduction — TXT</option><option value="original">Texte original — TXT</option><option value="bilingual">Original et traduction — TXT</option><option value="srt">Sous-titres traduits — SRT</option></select><button data-document-export>Exporter</button></div><p class="note">Les retouches du texte complet sont incluses dans les TXT. Pour le SRT, utilisez Corriger sur chaque phrase afin de conserver ses temps. La dernière session est sauvegardée à l’arrêt. Exportez les sessions que vous souhaitez conserver durablement.</p></section>
  </section><button class="resize-grip" aria-label="Redimensionner la fenêtre" title="Faites glisser ce coin pour redimensionner" tabindex="-1"></button>`;
  document.documentElement.appendChild(panel);
  applyOverlaySize(760, Math.min(480, window.innerHeight * .7));
  root.querySelectorAll<HTMLButtonElement>('[data-size]').forEach(button => {
    button.onclick = () => {
      sizeChangedByUser = true;
      const bounds = panel!.getBoundingClientRect();
      const width = bounds.width || parseFloat(panel!.style.width);
      const height = bounds.height || parseFloat(panel!.style.height);
      const factor = button.dataset.size === 'larger' ? 1.15 : 1 / 1.15;
      applyOverlaySize(Math.round(width * factor), Math.round(height * factor));
      chrome.storage.local.set({ overlayDimensions: { width: parseFloat(panel!.style.width), height: parseFloat(panel!.style.height) } }).catch(() => undefined);
    };
  });
  window.addEventListener('resize', () => {
    if (panel?.isConnected) applyOverlaySize(parseFloat(panel.style.width), parseFloat(panel.style.height));
  });
  const grip = root.querySelector<HTMLButtonElement>('.resize-grip')!;
  let resizing: { id: number; x: number; y: number; width: number; height: number } | null = null;
  grip.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    sizeChangedByUser = true;
    const bounds = panel!.getBoundingClientRect();
    resizing = {id: event.pointerId, x: event.clientX, y: event.clientY,
      width: bounds.width || parseFloat(panel!.style.width), height: bounds.height || parseFloat(panel!.style.height)};
    Object.assign(panel!.style, {left: `${bounds.left}px`, top: `${bounds.top}px`, right: 'auto', bottom: 'auto'});
    grip.setPointerCapture(event.pointerId);
    event.preventDefault();
  });
  grip.addEventListener('pointermove', event => {
    if (!resizing || event.pointerId !== resizing.id) return;
    applyOverlaySize(resizing.width + event.clientX - resizing.x, resizing.height + event.clientY - resizing.y);
  });
  const finishResize = (event: PointerEvent) => {
    if (!resizing || event.pointerId !== resizing.id) return;
    resizing = null;
    chrome.storage.local.set({overlayDimensions: {width: parseFloat(panel!.style.width), height: parseFloat(panel!.style.height)}}).catch(() => undefined);
  };
  grip.addEventListener('pointerup', finishResize);
  grip.addEventListener('pointercancel', finishResize);
  grip.addEventListener('lostpointercapture', finishResize);
  const historyLog = root.querySelector<HTMLElement>('.transcript')!;
  historyLog.addEventListener('wheel', event => {
    if (event.deltaY < 0 && historyEnd === null && displayedHistory().length) {
      historyEnd = displayedHistory().length; updateHistoryControls();
    }
  }, {passive: true});
  historyLog.addEventListener('scroll', () => {
    if (displayedHistory().length && historyEnd === null && historyLog.scrollHeight - historyLog.clientHeight - historyLog.scrollTop > 8) {
      historyEnd = displayedHistory().length; updateHistoryControls();
    }
  });
  root.querySelector<HTMLButtonElement>('[data-history-previous]')!.onclick = () => {
    if (historyEnd === null) historyEnd = displayedHistory().length;
    if (historyLog.scrollTop <= 1 && historyEnd > 150) {
      historyEnd = Math.max(150, historyEnd - 100);
      renderHistory(); historyLog.scrollTop = 0;
    } else historyLog.scrollTop = Math.max(0, historyLog.scrollTop - Math.max(120, historyLog.clientHeight * .8));
    updateHistoryControls();
  };
  root.querySelector<HTMLButtonElement>('[data-history-live]')!.onclick = () => {
    historyEnd = null; renderHistory();
  };
  root.querySelector<HTMLButtonElement>('[data-close]')!.onclick = () => { hiddenByUser = true; panel!.style.display = "none"; };
  root.querySelector<HTMLButtonElement>('[data-settings]')!.onclick = (event) => {
    const settings = root!.querySelector<HTMLElement>('.settings')!;
    settings.hidden = !settings.hidden;
    (event.currentTarget as HTMLElement).setAttribute("aria-expanded", String(!settings.hidden));
  };
  root.querySelectorAll<HTMLButtonElement>('[data-view]').forEach((button) => {
    button.onclick = () => { bilingual = button.dataset.view === "both"; renderHistory(); chrome.storage.local.set({ overlayBilingual: bilingual }).catch(() => undefined); };
  });
  root.querySelector<HTMLSelectElement>('#reading-mode')!.onchange = (event) => {
    readingModeChangedByUser = true;
    finalOnly = (event.target as HTMLSelectElement).value !== 'progressive';
    historyEnd = null;
    renderHistory();
    chrome.storage.local.set({ overlayReadingMode: finalOnly ? 'final' : 'progressive' }).catch(() => undefined);
    chrome.runtime.sendMessage({type: 'reading.change', translateDrafts: !finalOnly}).then(response => {
      if (response?.ok === false) setNotice(response.error ?? 'Mode de lecture non appliqué au moteur.');
    }).catch(() => setNotice('Connexion au moteur interrompue.'));
  };
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
  root.querySelectorAll<HTMLButtonElement>('[data-export]').forEach(button => { button.onclick = () => exportTranscript(button.dataset.export!); });
  root.querySelector<HTMLButtonElement>('[data-document]')!.onclick = () => {
    root!.querySelector<HTMLElement>('.document')!.hidden = false; renderDocument();
  };
  root.querySelector<HTMLButtonElement>('[data-restore]')!.onclick = async () => {
    if (sessionActive) { setNotice('Arrêtez la traduction avant d’ouvrir la dernière session.'); return; }
    try {
      const {transcriptArchive: archive} = await chrome.storage.local.get('transcriptArchive');
      if (!archive || archive.version !== 1 || !Array.isArray(archive.rows) || !archive.rows.length) { setNotice('Aucune session sauvegardée.'); return; }
      transcriptHistory = archive.rows.filter((item: TranscriptRow) => item.final === true && typeof item.original === 'string' && typeof item.translation === 'string');
      documentOriginal = typeof archive.documentOriginal === 'string' ? archive.documentOriginal : undefined;
      documentTranslation = typeof archive.documentTranslation === 'string' ? archive.documentTranslation : undefined;
      historyEnd = null; renderedRows.clear(); clearStudy(); renderHistory();
      root!.querySelector<HTMLElement>('.document')!.hidden = false; renderDocument();
      setDocumentNotice('Dernière session sauvegardée — transcription disponible pour relecture et export.');
    } catch { setNotice('Lecture de la sauvegarde impossible.'); }
  };
  root.querySelector<HTMLButtonElement>('[data-document-close]')!.onclick = () => { root!.querySelector<HTMLElement>('.document')!.hidden = true; };
  root.querySelector<HTMLTextAreaElement>('#document-original')!.oninput = event => {
    if (!sessionActive) { documentOriginal = (event.target as HTMLTextAreaElement).value; clearStudy(); saveArchive(); }
  };
  root.querySelector<HTMLTextAreaElement>('#document-translation')!.oninput = event => {
    if (!sessionActive) { documentTranslation = (event.target as HTMLTextAreaElement).value; clearStudy(); saveArchive(); }
  };
  root.querySelector<HTMLButtonElement>('[data-document-export]')!.onclick = () => exportDocument();
  root.querySelectorAll<HTMLButtonElement>('[data-study]').forEach(button => { button.onclick = () => buildStudy(button.dataset.study!); });
  root.querySelector<HTMLButtonElement>('[data-study-export]')!.onclick = () => {
    if (studyExportText) { downloadText(studyExportText, 'txt', 'fiche-revision'); setDocumentNotice('Fiche de révision exportée.'); }
  };
  root.querySelector<HTMLSelectElement>('#study-source')!.onchange = clearStudy;
  makeDraggable(panel, root.querySelector<HTMLElement>('header')!);
  const currentRoot = root;
  chrome.storage.local.get(["outputMode", "overlayBilingual", "overlayFontSize", "overlayDimensions", "overlayReadingMode"]).then((settings) => {
    if (root !== currentRoot) return;
    if (!sizeChangedByUser && settings.overlayDimensions) {
      applyOverlaySize(settings.overlayDimensions.width, settings.overlayDimensions.height);
    }
    if (!readingModeChangedByUser) finalOnly = settings.overlayReadingMode !== 'progressive';
    currentRoot.querySelector<HTMLSelectElement>('#reading-mode')!.value = finalOnly ? 'final' : 'progressive';
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

function applyOverlaySize(requestedWidth: number, requestedHeight: number) {
  if (!panel || !root) return;
  const maxWidth = Math.max(1, window.innerWidth - 16);
  const maxHeight = Math.max(1, window.innerHeight - 16);
  const minWidth = Math.min(320, maxWidth), minHeight = Math.min(240, maxHeight);
  const width = Math.max(minWidth, Math.min(maxWidth, Number.isFinite(requestedWidth) ? requestedWidth : 760));
  const height = Math.max(minHeight, Math.min(maxHeight, Number.isFinite(requestedHeight) ? requestedHeight : 480));
  Object.assign(panel.style, {width: `${width}px`, height: `${height}px`, minWidth: `${minWidth}px`, minHeight: `${minHeight}px`});
  panel.style.resize = 'none';
  panel.toggleAttribute('data-compact', width < 540 || height < 380);
  const log = root.querySelector<HTMLElement>('.transcript');
  if (log && historyEnd === null) log.scrollTop = log.scrollHeight;
  const left = parseFloat(panel.style.left), top = parseFloat(panel.style.top);
  if (Number.isFinite(left)) panel.style.left = `${Math.max(8, Math.min(window.innerWidth - width - 8, left))}px`;
  else panel.style.right = `${Math.min(24, (window.innerWidth - width) / 2)}px`;
  if (Number.isFinite(top)) panel.style.top = `${Math.max(8, Math.min(window.innerHeight - height - 8, top))}px`;
  else panel.style.bottom = `${Math.min(24, (window.innerHeight - height) / 2)}px`;
  root.querySelector<HTMLButtonElement>('[data-size=smaller]')!.disabled = width <= minWidth && height <= minHeight;
  root.querySelector<HTMLButtonElement>('[data-size=larger]')!.disabled = width >= maxWidth && height >= maxHeight;
}

function setNotice(text: string) { if (root) root.querySelector<HTMLElement>('.notice')!.textContent = text; }

function displayedHistory() { return finalOnly ? transcriptHistory.filter(item => item.final) : transcriptHistory; }

function renderHistory() {
  if (!root) return;
  const log = root.querySelector<HTMLElement>('.transcript')!;
  const previousScroll = log.scrollTop;
  const history = displayedHistory();
  const end = Math.min(historyEnd ?? history.length, history.length);
  const visible = history.slice(Math.max(0, end - 150), end);
  const desired: HTMLElement[] = [];
  for (const item of renderedRows.keys()) if (!visible.includes(item)) renderedRows.delete(item);
  if (!visible.length) log.replaceChildren();
  if (!visible.length) { const empty = document.createElement('div'); empty.className = 'empty'; empty.textContent = finalOnly ? 'En attente d’une phrase finalisée…' : 'Les phrases traduites apparaîtront ici.'; log.appendChild(empty); }
  for (const item of visible) {
    const signature = JSON.stringify([item, bilingual]);
    const cached = renderedRows.get(item);
    if (cached?.signature === signature) { desired.push(cached.row); continue; }
    const row = document.createElement('div'); row.className = 'phrase'; row.dataset.pending = String(!item.final);
    const meta = document.createElement('div'); meta.className = 'phrase-head';
    const route = document.createElement('span');
    const names: Record<string,string> = {en:'Anglais',fr:'Français',es:'Espagnol',zh:'Chinois simplifié'};
    route.textContent = item.sourceLanguage && item.targetLanguage ? `${names[item.sourceLanguage] ?? item.sourceLanguage} → ${names[item.targetLanguage] ?? item.targetLanguage}` : 'Traduction';
    const stateLabel = document.createElement('span'); stateLabel.className = 'state-label';
    const review = Boolean(item.bounded || item.uncertainWords?.length);
    stateLabel.textContent = item.corrected ? 'Corrigée' : !item.final ? 'Provisoire' : review ? 'Finalisée · à relire' : 'Finalisée';
    stateLabel.classList.toggle('review', review || !item.final);
    meta.append(route, stateLabel); row.append(meta);
    const original = document.createElement('div'); original.className = 'original'; renderOriginal(original, item); original.hidden = !bilingual && Boolean(item.translation);
    const translation = document.createElement('div'); translation.className = 'translation'; translation.textContent = item.translation || 'Traduction indisponible pour cet extrait.';
    row.append(original, translation); desired.push(row); renderedRows.set(item, {signature, row});
    if (item.uncertainWords?.length) {
      const warning = document.createElement('div'); warning.className = 'note';
      warning.textContent = `${item.final ? "Texte finalisé" : "Texte provisoire"} — reconnaissance incertaine : ${item.uncertainWords.join(', ')}. Relisez ce passage ; ce repère ne mesure pas la qualité de la traduction.`;
      row.append(warning);
    }
    if (item.corrected) { const label = document.createElement('div'); label.className = 'note'; label.textContent = 'Correction personnelle'; row.append(label); }
    if (item.final) {
      const tools = document.createElement('div'); tools.className = 'tools';
      const edit = document.createElement('button'); edit.textContent = 'Corriger';
      edit.onclick = () => openCorrection(row, item); tools.append(edit);
      const copy = document.createElement('button'); copy.textContent = 'Copier';
      copy.onclick = async () => { try { await navigator.clipboard.writeText(item.translation || item.original); setNotice('Traduction copiée.'); } catch { setNotice('Copie indisponible : sélectionnez le texte pour le copier.'); } }; tools.append(copy);
      if (item.timing === 'video' && Number.isFinite(item.start)) {
        const replay = document.createElement('button'); replay.textContent = 'Réécouter';
        replay.onclick = () => { const video = captionVideo ?? document.querySelector('video'); if (video) { video.currentTime = item.start!; video.play().catch(() => setNotice('Appuyez sur Lecture dans la vidéo.')); } };
        tools.append(replay);
      }
      row.append(tools);
    }
    if (!item.final || item.bounded) {
      const label = document.createElement('div'); label.className = 'note';
      label.textContent = !item.final ? 'La traduction s’actualise jusqu’à la fin de la phrase.' : 'Fin de phrase non confirmée.';
      row.appendChild(label);
    }
  }
  if (desired.length) {
    const keep = new Set(desired);
    for (const child of Array.from(log.children)) if (!keep.has(child as HTMLElement)) child.remove();
    desired.forEach((row, index) => { if (log.children[index] !== row) log.insertBefore(row, log.children[index] ?? null); });
  }
  root.querySelectorAll<HTMLElement>('[data-view]').forEach((button) => button.setAttribute('aria-pressed', String((button.dataset.view === 'both') === bilingual)));
  log.scrollTop = historyEnd === null ? log.scrollHeight : previousScroll;
  updateHistoryControls();
  renderDocument();
}

function updateHistoryControls() {
  if (!root) return;
  const history = displayedHistory();
  const end = Math.min(historyEnd ?? history.length, history.length);
  const unread = history.length - end;
  root.querySelector<HTMLButtonElement>('[data-history-previous]')!.disabled = history.length < 2;
  const live = root.querySelector<HTMLButtonElement>('[data-history-live]')!;
  live.disabled = historyEnd === null;
  live.textContent = unread ? `Revenir au direct (+${unread})` : 'Revenir au direct';
  root.querySelector('[data-history-status]')!.textContent = historyEnd === null ? 'Suivi en direct' : `Relecture · lignes ${Math.max(1, end - 149)} à ${end}`;
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

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "overlay.ping") { sendResponse({ok: true, version: "1.18.0"}); return; }
  if (message.type === "overlay.reveal") {
    hiddenByUser = false; ensureOverlay(); panel!.style.display = "block";
    Object.assign(panel!.style, {left: "auto", top: "auto", right: "24px", bottom: "24px"});
    root!.querySelector<HTMLElement>('[data-status]')!.textContent = message.active ? 'Traduction en cours' : 'Prêt à traduire';
    root!.querySelector<HTMLElement>('.status')!.classList.toggle('stopped', !message.active);
    root!.querySelector<HTMLButtonElement>('[data-stop]')!.disabled = !message.active;
    setNotice(message.active ? 'Fenêtre réaffichée.' : 'Cliquez sur Démarrer la traduction dans l’extension.');
    sendResponse({ok: true}); return;
  }
  if (message.type === "captions.probe") { const choice = accessibleCaptions(message.sourceLanguage ?? "auto"); sendResponse({ok: Boolean(choice), error: choice ? undefined : "Aucune piste activée accessible dans la langue choisie"}); return; }
  if (message.type === "captions.start") { sendResponse(startCaptions(message.sourceLanguage ?? "auto")); return; }
  if (message.type === "captions.stop") { stopCaptions?.(); sendResponse({ok: true}); return; }
  if (message.type === "overlay.metrics") {
    ensureOverlay();
    const seconds = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? `${(value / 1000).toFixed(1)} s` : "—";
    root!.querySelector(".metrics")!.textContent = `Calcul : ${seconds(message.processingMs)} · Attente + calcul : ${seconds(message.responseMs)} · ${message.pending ?? 0} extrait(s) en attente`;
    return;
  }
  if (message.type === 'overlay.show') {
    if (String(message.text).startsWith('Connexion ')) { transcriptHistory = []; historyEnd = null; documentOriginal = documentTranslation = undefined; clearStudy(); hiddenByUser = false; }
    sessionActive = true;
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
    const item: TranscriptRow = { original, translation, id, revision, final: message.final !== false, bounded: message.bounded === true,
      start: message.start, end: message.end, timing: message.timing, origin: message.origin,
      uncertainWords: Array.isArray(message.uncertainWords) ? message.uncertainWords.filter((word: unknown) => typeof word === 'string').slice(0,30) : [],
      sourceLanguage: message.sourceLanguage, targetLanguage: message.targetLanguage };
    if (existing >= 0) {
      if (transcriptHistory[existing].final || revision <= transcriptHistory[existing].revision) return;
      transcriptHistory[existing] = item;
    } else transcriptHistory.push(item);
    if (!finalOnly || item.final) { setNotice(''); renderHistory(); }
  }
  if (message.type === 'overlay.hide') { if (panel) panel.style.display = 'none'; }
  if (message.type === 'overlay.mode' && root) {
    root.querySelector<HTMLSelectElement>('#output-mode')!.value = message.outputMode;
    if (message.outputMode === 'voice') panel!.style.display = 'none';
    else if (!hiddenByUser) panel!.style.display = 'block';
  }
  if ((message.type === 'overlay.stopped' || message.type === 'overlay.error') && root) {
    stopCaptions?.();
    sessionActive = false;
    transcriptHistory.forEach((item) => { if (!item.final) { item.final = true; item.bounded = true; } });
    renderHistory();
    root.querySelector<HTMLElement>('[data-status]')!.textContent = 'Traduction arrêtée';
    root.querySelector<HTMLElement>('.status')!.classList.add('stopped');
    root.querySelector<HTMLButtonElement>('[data-stop]')!.disabled = true;
    saveArchive();
    setNotice(message.type === 'overlay.error' ? message.text : 'Capture arrêtée. L’historique reste consultable.');
  }
});

function renderOriginal(element: HTMLElement, item: TranscriptRow) {
  const uncertain = new Set((item.uncertainWords ?? []).map(word => word.toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, '')));
  item.original.split(/(\s+)/).forEach(token => {
    const key = token.toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
    if (key && uncertain.has(key)) { const mark = document.createElement('mark'); mark.textContent = token; element.append(mark); }
    else element.append(document.createTextNode(token));
  });
}
function openCorrection(row: HTMLElement, item: TranscriptRow) {
  if (row.querySelector('.editor')) return;
  const editor = document.createElement('div'); editor.className = 'editor';
  const labelOriginal = document.createElement('label'); labelOriginal.textContent = 'Texte original (corriger l’affichage)';
  const original = document.createElement('textarea'); original.value = item.original; original.maxLength = 2000;
  const labelTranslation = document.createElement('label'); labelTranslation.textContent = 'Traduction corrigée';
  const translation = document.createElement('textarea'); translation.value = item.translation; translation.maxLength = 2000;
  const note = document.createElement('p'); note.className = 'note'; note.textContent = 'La traduction sera réutilisée pour le texte initial identique, dans ces langues, à la prochaine session. Aucun entraînement automatique.';
  const save = document.createElement('button'); save.textContent = 'Enregistrer localement';
  const cancel = document.createElement('button'); cancel.textContent = 'Annuler'; cancel.onclick = () => editor.remove();
  save.onclick = async () => {
    if (!original.value.trim() || !translation.value.trim()) { setNotice('Les deux textes sont requis.'); return; }
    save.disabled = true;
    try {
      const response = await chrome.runtime.sendMessage({type: 'correction.save', correction: {original: item.recognizedOriginal ?? item.original, translation: translation.value.trim(), source: item.sourceLanguage, target: item.targetLanguage}});
      if (!response?.ok) throw new Error(response?.error ?? 'Enregistrement impossible');
      item.recognizedOriginal ??= item.original;
      item.original = original.value.trim(); item.translation = translation.value.trim(); item.corrected = true; item.uncertainWords = [];
      clearStudy(); renderHistory(); if (!sessionActive) saveArchive(); setNotice('Correction enregistrée. Redémarrez la traduction pour la réutiliser.');
    } catch (error) { save.disabled = false; setNotice(String(error)); }
  };
  editor.append(labelOriginal, original, labelTranslation, translation, note, save, cancel); row.append(editor);
}
function srtTime(seconds: number) {
  const ms = Math.max(0, Math.round(seconds * 1000));
  return `${String(Math.floor(ms / 3600000)).padStart(2,'0')}:${String(Math.floor(ms / 60000) % 60).padStart(2,'0')}:${String(Math.floor(ms / 1000) % 60).padStart(2,'0')},${String(ms % 1000).padStart(3,'0')}`;
}
function clearStudy() {
  studyExportText = '';
  root?.querySelector('.study-result')?.replaceChildren();
  const button = root?.querySelector<HTMLButtonElement>('[data-study-export]'); if (button) button.hidden = true;
}
function buildStudy(kind: string) {
  clearStudy();
  if (sessionActive) { setDocumentNotice('Arrêtez la traduction et relisez le document avant de créer une fiche.'); return; }
  const source = root!.querySelector<HTMLSelectElement>('#study-source')!.value;
  const text = root!.querySelector<HTMLTextAreaElement>(source === 'original' ? '#document-original' : '#document-translation')!.value;
  if (!text.trim()) { setDocumentNotice('Aucun texte à étudier.'); return; }
  const aid = generateStudyAid(text);
  const result = root!.querySelector<HTMLElement>('.study-result')!;
  const title = document.createElement('h3'); title.textContent = kind === 'quiz' ? 'Quiz à trous' : 'Résumé — phrases essentielles'; result.append(title);
  if (kind === 'summary') {
    if (!aid.summary.length) { setDocumentNotice('Aucune phrase exploitable pour le résumé.'); return; }
    const list = document.createElement('ol');
    for (const sentence of aid.summary) { const item = document.createElement('li'); item.textContent = sentence; list.append(item); }
    result.append(list); studyExportText = `RÉSUMÉ EXTRACTIF — ${source === 'original' ? 'TEXTE ORIGINAL' : 'TRADUCTION'}\n\n${aid.summary.join('\n\n')}`;
  } else {
    if (!aid.questions.length) { setDocumentNotice('Texte trop court ou sans termes adaptés au quiz. Ajoutez une transcription plus complète.'); return; }
    aid.questions.forEach((question,index) => {
      const article = document.createElement('article');
      const prompt = document.createElement('p'); prompt.textContent = `${index + 1}. Complétez l’extrait : ${question.prompt}`;
      const answer = document.createElement('input'); answer.type = 'text'; answer.setAttribute('aria-label', `Réponse à la question ${index+1}`); answer.autocomplete = 'off';
      const check = document.createElement('button'); check.textContent = 'Vérifier';
      const feedback = document.createElement('p'); feedback.setAttribute('role','status');
      check.onclick = () => { feedback.textContent = !answer.value.trim() ? 'Saisissez une réponse.' : normalizeAnswer(answer.value) === normalizeAnswer(question.answer) ? 'Bonne réponse.' : 'À revoir : consultez la réponse et l’extrait.'; };
      const details = document.createElement('details'); const reveal = document.createElement('summary'); reveal.textContent = 'Voir la réponse et l’extrait';
      const evidence = document.createElement('p'); evidence.textContent = `Réponse : ${question.answer}\nExtrait : ${question.source}`;
      details.append(reveal,evidence); article.append(prompt,answer,check,feedback,details); result.append(article);
    });
    studyExportText = `QUIZ À TROUS — ${source === 'original' ? 'TEXTE ORIGINAL' : 'TRADUCTION'}\n\n` + aid.questions.map((q,i)=>`${i+1}. ${q.prompt}`).join('\n\n') + '\n\nCORRIGÉ ET EXTRAITS\n\n' + aid.questions.map((q,i)=>`${i+1}. ${q.answer}\n${q.source}`).join('\n\n');
  }
  root!.querySelector<HTMLButtonElement>('[data-study-export]')!.hidden = false;
  setDocumentNotice('Fiche créée localement à partir du texte choisi. Vérifiez-la avec la vidéo.');
}
function renderDocument() {
  if (!root) return;
  const rows = transcriptHistory.filter(item => item.final);
  root.querySelector('[data-document-count]')!.textContent = `${rows.length} phrase(s) finalisée(s)`;
  const pane = root.querySelector<HTMLElement>('.document')!;
  if (pane.hidden) return;
  const original = root.querySelector<HTMLTextAreaElement>('#document-original')!;
  const translation = root.querySelector<HTMLTextAreaElement>('#document-translation')!;
  original.readOnly = translation.readOnly = sessionActive;
  original.value = documentOriginal ?? rows.map(item => item.original).join('\n\n');
  translation.value = documentTranslation ?? rows.map(item => item.translation || '[Traduction indisponible]').join('\n\n');
  root.querySelector('[data-document-note]')!.textContent = sessionActive
    ? 'Texte finalisé disponible pendant la lecture. Arrêtez la traduction pour relire et retoucher le document complet.'
    : 'Relisez et corrigez les deux textes avant l’export TXT. Les erreurs ne sont pas corrigées automatiquement. Retouches conservées dans cette page uniquement.';
}
function downloadText(text: string, extension: string, label: string) {
  const url = URL.createObjectURL(new Blob([text], {type: 'text/plain;charset=utf-8'}));
  const link = document.createElement('a'); link.href = url; link.download = `Polyglot-${label}-${new Date().toISOString().replace(/[:.]/g,'-')}.${extension}`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function exportDocument() {
  const format = root!.querySelector<HTMLSelectElement>('#document-format')!.value;
  if (format === 'srt') { exportTranscript('srt'); return; }
  const rows = transcriptHistory.filter(item => item.final);
  if (!rows.length) { setDocumentNotice('Aucune phrase finalisée à exporter.'); return; }
  const original = documentOriginal ?? rows.map(item => item.original).join('\n\n');
  const translation = documentTranslation ?? rows.map(item => item.translation || '[Traduction indisponible]').join('\n\n');
  const text = format === 'original' ? original : format === 'translation' ? translation : `TEXTE ORIGINAL\n\n${original}\n\nTRADUCTION\n\n${translation}`;
  downloadText(text, 'txt', format);
  setDocumentNotice('Transcription complète exportée en TXT, avec vos retouches.');
}
function setDocumentNotice(text: string) {
  setNotice(text);
  if (root && !root.querySelector<HTMLElement>('.document')!.hidden) root.querySelector('[data-document-note]')!.textContent = text;
}
function exportTranscript(format: string) {
  const rows = transcriptHistory.filter(item => item.final);
  if (!rows.length) { setDocumentNotice('Aucune phrase finalisée à exporter.'); return; }
  const timed = rows.filter(item => Number.isFinite(item.start) && Number.isFinite(item.end) && item.end! > item.start!).sort((a,b) => a.start! - b.start!);
  const text = format === 'srt' ? timed.map((item,index) => `${index + 1}\n${srtTime(item.start!)} --> ${srtTime(item.end!)}\n${(item.translation || item.original).replace(/\n\s*\n/g, '\n')}`).join('\n\n') + '\n'
    : rows.map(item => `${item.original}\n${item.translation}${item.corrected ? '\n[Correction personnelle]' : ''}`).join('\n\n');
  if (format === 'srt' && !timed.length) { setDocumentNotice('Aucun repère temporel à exporter.'); return; }
  downloadText(text, format, 'session');
  setDocumentNotice(format === 'srt' ? 'SRT exporté avec les corrections par phrase. Les retouches du document complet concernent les TXT seulement. Audio : repères à ajuster pour la vidéo.' : 'Historique complet TXT exporté avec les corrections par phrase.');
}
let captionVideo: HTMLVideoElement | null = null;
function accessibleCaptions(source: string) {
  const videos = Array.from(document.querySelectorAll('video')).sort((a,b) => Number(a.paused) - Number(b.paused));
  for (const video of videos) {
    const track = Array.from(video.textTracks).find(track =>
      ['subtitles','captions'].includes(track.kind) && track.mode !== 'disabled' &&
      ['en','fr','es','zh'].includes(track.language.split('-')[0] || source) &&
      (source === 'auto' || !track.language || track.language.split('-')[0] === source));
    if (track) return {video, track};
  }
  return undefined;
}
function startCaptions(source: string): {ok: boolean; error?: string} {
  stopCaptions?.();
  const selection = accessibleCaptions(source);
  if (!selection) return {ok: false, error: 'Activez une piste originale accessible en anglais, français, espagnol ou chinois, ou utilisez le son.'};
  const {video} = selection;
  const choose = () => accessibleCaptions(source)?.video === video ? accessibleCaptions(source)?.track : undefined;
  captionVideo = video;
  const seen = new Set<string>();
  let stopped = false, busy = false;
  let lastEnd: number | null = null;
  let flushed = false;
  const read = async () => {
    if (stopped || busy) return;
    const track = choose(); if (!track) { setNotice('Piste désactivée : réactivez les sous-titres dans le lecteur.'); return; }
    const cues = Array.from(track.activeCues ?? []);
    if (video.paused && !video.ended && cues.length) return;
    busy = true;
    try {
      for (const cue of cues) {
        if (stopped) break;
        const text = typeof VTTCue !== "undefined" && cue instanceof VTTCue ? (cue.getCueAsHTML().textContent ?? '').trim() : 'text' in cue ? String(cue.text).replace(/<[^>]*>/g, '').trim() : '';
        const key = `${cue.startTime}:${cue.endTime}:${text}`;
        if (!text || seen.has(key)) continue;
        const response = await chrome.runtime.sendMessage({type: 'caption.cue', cue: {text, start: cue.startTime, end: cue.endTime, language: source === 'auto' ? track.language.split('-')[0] : source}});
        if (!response?.ok) { setNotice(response?.error ?? 'Sous-titre non transmis. Mettez la vidéo en pause.'); break; }
        lastEnd = cue.endTime; flushed = false;
        seen.add(key); if (seen.size > 1000) seen.delete(seen.values().next().value!);
      }
      if (!stopped && (!cues.length || video.ended) && !flushed && lastEnd !== null && (video.currentTime >= lastEnd + .75 || video.ended)) {
        const response = await chrome.runtime.sendMessage({type: 'caption.flush', position: video.ended ? Math.max(video.currentTime, lastEnd + .75) : video.currentTime});
        if (response?.ok) flushed = true;
      }
    } catch { setNotice('Connexion aux sous-titres interrompue.'); }
    finally { busy = false; }
  };
  const onSeek = () => { seen.clear(); lastEnd = null; flushed = false; };
  video.addEventListener('seeking', onSeek);
  video.addEventListener('ended', read);
  const tracks = Array.from(video.textTracks);
  tracks.forEach(track => track.addEventListener('cuechange', read));
  const timer = setInterval(read, 250);
  stopCaptions = () => { stopped = true; clearInterval(timer); video.removeEventListener('seeking', onSeek); video.removeEventListener('ended', read); tracks.forEach(track => track.removeEventListener('cuechange', read)); stopCaptions = undefined; };
  read(); setNotice('Sous-titres accessibles sélectionnés — traduction locale.');
  return {ok: true};
}

})();
