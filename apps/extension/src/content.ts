// Fenêtre de transcription isolée des styles de la page vidéo.
const ID = "polyglot-live-subtitles";
let panel: HTMLElement | null = null;
let root: ShadowRoot | null = null;
let hiddenByUser = false;
let bilingual = false;
let fontSize = 23;
interface TranscriptRow { original: string; translation: string; id?: string; revision: number; final: boolean; bounded?: boolean; start?: number; end?: number; timing?: string; origin?: string; uncertainWords?: string[]; sourceLanguage?: string; targetLanguage?: string; corrected?: boolean; recognizedOriginal?: string; }
let transcriptHistory: TranscriptRow[] = [];
let stopCaptions: (() => void) | undefined;

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
    .settings{padding:14px 18px;background:#242424;border-bottom:1px solid #ffffff14}.settings[hidden]{display:none}.settings label{display:block;margin-bottom:7px;color:#d3d3d3}.settings select{width:100%;padding:8px;background:#303030;color:#fff;border:1px solid #555;border-radius:6px;margin-bottom:12px}.settings input{width:100%}.settings{max-height:45%;overflow:auto}textarea{width:100%;padding:8px;background:#303030;color:#fff;border:1px solid #666;border-radius:6px}mark{background:#725a20;color:#fff}.tools{display:flex;gap:8px;margin-top:10px;flex-wrap:wrap}.metrics{color:#bbb;font-size:12px;padding:6px 18px;background:#202020}.editor{margin-top:10px}.note{font-size:12px;color:#aaa;margin:4px 0 0}
    .transcript{flex:1;overflow:auto;padding:12px 24px 24px;scrollbar-color:#5a5a5a transparent}.phrase{padding:18px 0;border-bottom:1px solid #ffffff0a}.translation{font-size:var(--text-size,23px);font-weight:600;line-height:1.55;overflow-wrap:anywhere;white-space:pre-wrap}.original{font-size:16px;color:#aaa;margin-bottom:7px;line-height:1.5;white-space:pre-wrap}.original[hidden]{display:none}.empty{padding-top:24px;color:#aaa;font-size:17px}.notice{padding:8px 18px;color:#ccc;font-size:12px;background:#202020}.notice:empty{display:none}
  </style><section class="window" aria-label="Traduction Polyglot Live">
    <header><span class="brand">Polyglot Live</span><span class="status"><span class="dot"></span><span data-status>Traduction en cours</span></span><button class="stop" data-stop>Arrêter</button><div class="views" aria-label="Affichage du texte"><button data-view="both" aria-pressed="false">Les deux</button><button data-view="translation" aria-pressed="true">Traduction</button></div><button class="icon" data-settings aria-label="Paramètres" aria-expanded="false">⚙</button><button class="icon" data-close aria-label="Masquer la fenêtre">×</button></header>
    <div class="settings" hidden><label for="output-mode">Mode de traduction</label><select id="output-mode"><option value="subtitles">Sous-titres traduits</option><option value="voice">Voix traduite</option><option value="both">Sous-titres + voix traduite</option></select><label for="text-size">Taille du texte</label><input id="text-size" type="range" min="16" max="36" value="23"><div class="tools"><button data-export="txt">Exporter TXT</button><button data-export="srt">Exporter SRT</button></div><p class="note">Export des 150 dernières phrases finalisées. Audio : temps relatifs au début de la capture ; sous-titres : temps de la vidéo.</p><p class="note">« Les deux » affiche le texte original et sa traduction. La voix conserve le son original. Le moteur local gratuit doit être lancé avec DEMARRER.cmd. Aucun service payant n’est utilisé.</p></div>
    <div class="metrics">Temps de traitement : en attente</div><div class="notice" role="status"></div><div class="transcript" role="log" aria-label="Historique des traductions"><div class="empty">Les phrases traduites apparaîtront ici.</div></div>
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
  root.querySelectorAll<HTMLButtonElement>('[data-export]').forEach(button => { button.onclick = () => exportTranscript(button.dataset.export!); });
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
    const original = document.createElement('div'); original.className = 'original'; renderOriginal(original, item); original.hidden = !bilingual && Boolean(item.translation);
    const translation = document.createElement('div'); translation.className = 'translation'; translation.textContent = item.translation || 'Traduction indisponible pour cet extrait.';
    row.append(original, translation); log.appendChild(row);
    if (item.uncertainWords?.length) {
      const warning = document.createElement('div'); warning.className = 'note';
      warning.textContent = `Reconnaissance à vérifier : ${item.uncertainWords.join(', ')}. Ce repère ne mesure pas la fiabilité de la traduction.`;
      row.append(warning);
    }
    if (item.corrected) { const label = document.createElement('div'); label.className = 'note'; label.textContent = 'Correction personnelle'; row.append(label); }
    if (item.final) {
      const tools = document.createElement('div'); tools.className = 'tools';
      const edit = document.createElement('button'); edit.textContent = 'Corriger';
      edit.onclick = () => openCorrection(row, item); tools.append(edit);
      if (item.timing === 'video' && Number.isFinite(item.start)) {
        const replay = document.createElement('button'); replay.textContent = 'Réécouter';
        replay.onclick = () => { const video = captionVideo ?? document.querySelector('video'); if (video) { video.currentTime = item.start!; video.play().catch(() => setNotice('Appuyez sur Lecture dans la vidéo.')); } };
        tools.append(replay);
      }
      row.append(tools);
    }
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

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "captions.start") { sendResponse(startCaptions(message.sourceLanguage ?? "auto")); return; }
  if (message.type === "captions.stop") { stopCaptions?.(); sendResponse({ok: true}); return; }
  if (message.type === "overlay.metrics") {
    ensureOverlay();
    const seconds = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? `${(value / 1000).toFixed(1)} s` : "—";
    root!.querySelector(".metrics")!.textContent = `Calcul : ${seconds(message.processingMs)} · Attente + calcul : ${seconds(message.responseMs)} · ${message.pending ?? 0} extrait(s) en attente`;
    return;
  }
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
    const item: TranscriptRow = { original, translation, id, revision, final: message.final !== false, bounded: message.bounded === true,
      start: message.start, end: message.end, timing: message.timing, origin: message.origin,
      uncertainWords: Array.isArray(message.uncertainWords) ? message.uncertainWords.filter((word: unknown) => typeof word === 'string').slice(0,30) : [],
      sourceLanguage: message.sourceLanguage, targetLanguage: message.targetLanguage };
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
    stopCaptions?.();
    transcriptHistory.forEach((item) => { if (!item.final) { item.final = true; item.bounded = true; } });
    renderHistory();
    root.querySelector<HTMLElement>('[data-status]')!.textContent = 'Traduction arrêtée';
    root.querySelector<HTMLElement>('.status')!.classList.add('stopped');
    root.querySelector<HTMLButtonElement>('[data-stop]')!.disabled = true;
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
      renderHistory(); setNotice('Correction enregistrée. Redémarrez la traduction pour la réutiliser.');
    } catch (error) { save.disabled = false; setNotice(String(error)); }
  };
  editor.append(labelOriginal, original, labelTranslation, translation, note, save, cancel); row.append(editor);
}
function srtTime(seconds: number) {
  const ms = Math.max(0, Math.round(seconds * 1000));
  return `${String(Math.floor(ms / 3600000)).padStart(2,'0')}:${String(Math.floor(ms / 60000) % 60).padStart(2,'0')}:${String(Math.floor(ms / 1000) % 60).padStart(2,'0')},${String(ms % 1000).padStart(3,'0')}`;
}
function exportTranscript(format: string) {
  const rows = transcriptHistory.filter(item => item.final);
  if (!rows.length) { setNotice('Aucune phrase finalisée à exporter.'); return; }
  const timed = rows.filter(item => Number.isFinite(item.start) && Number.isFinite(item.end) && item.end! > item.start!).sort((a,b) => a.start! - b.start!);
  const text = format === 'srt' ? timed.map((item,index) => `${index + 1}\n${srtTime(item.start!)} --> ${srtTime(item.end!)}\n${(item.translation || item.original).replace(/\n\s*\n/g, '\n')}`).join('\n\n') + '\n'
    : rows.map(item => `${item.original}\n${item.translation}${item.corrected ? '\n[Correction personnelle]' : ''}`).join('\n\n');
  if (format === 'srt' && !timed.length) { setNotice('Aucun repère temporel à exporter.'); return; }
  const url = URL.createObjectURL(new Blob([text], {type: 'text/plain;charset=utf-8'}));
  const link = document.createElement('a'); link.href = url; link.download = `Polyglot-${new Date().toISOString().replace(/[:.]/g,'-')}.${format}`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  setNotice(format === 'srt' ? 'SRT exporté. Audio : repères relatifs à la capture, à ajuster pour la vidéo.' : 'Historique TXT exporté.');
}
let captionVideo: HTMLVideoElement | null = null;
function startCaptions(source: string): {ok: boolean; error?: string} {
  stopCaptions?.();
  const candidates = Array.from(document.querySelectorAll('video')).filter(video => video.textTracks.length);
  const video = candidates.find(video => !video.paused) ?? candidates[0];
  if (!video) return {ok: false, error: 'Aucune piste accessible. Utilisez Reconnaître le son.'};
  const choose = () => Array.from(video.textTracks).find(track =>
    ['subtitles','captions'].includes(track.kind) && track.mode !== 'disabled' &&
    (source === 'auto' || !track.language || track.language.split('-')[0] === source));
  const initial = choose();
  if (!initial) return {ok: false, error: 'Activez les sous-titres du lecteur et choisissez leur langue originale.'};
  const language = initial.language.split('-')[0] || source;
  if (!['en','fr','es'].includes(source === 'auto' ? language : source)) return {ok: false, error: 'Choisissez Anglais, Français ou Espagnol comme langue originale.'};
  captionVideo = video;
  const seen = new Set<string>();
  let stopped = false, busy = false;
  const read = async () => {
    if (stopped || busy || video.paused) return;
    const track = choose(); if (!track) { setNotice('Piste désactivée : réactivez les sous-titres dans le lecteur.'); return; }
    const cues = Array.from(track.activeCues ?? []);
    busy = true;
    try {
      for (const cue of cues) {
        if (stopped) break;
        const text = typeof VTTCue !== "undefined" && cue instanceof VTTCue ? (cue.getCueAsHTML().textContent ?? '').trim() : 'text' in cue ? String(cue.text).replace(/<[^>]*>/g, '').trim() : '';
        const key = `${cue.startTime}:${cue.endTime}:${text}`;
        if (!text || seen.has(key)) continue;
        const response = await chrome.runtime.sendMessage({type: 'caption.cue', cue: {text, start: cue.startTime, end: cue.endTime, language: source === 'auto' ? track.language.split('-')[0] : source}});
        if (!response?.ok) { setNotice(response?.error ?? 'Sous-titre non transmis. Mettez la vidéo en pause.'); break; }
        seen.add(key); if (seen.size > 1000) seen.delete(seen.values().next().value!);
      }
    } catch { setNotice('Connexion aux sous-titres interrompue.'); }
    finally { busy = false; }
  };
  const tracks = Array.from(video.textTracks);
  tracks.forEach(track => track.addEventListener('cuechange', read));
  const timer = setInterval(read, 250);
  stopCaptions = () => { stopped = true; clearInterval(timer); tracks.forEach(track => track.removeEventListener('cuechange', read)); stopCaptions = undefined; };
  read(); setNotice('Sous-titres accessibles sélectionnés — traduction locale.');
  return {ok: true};
}
