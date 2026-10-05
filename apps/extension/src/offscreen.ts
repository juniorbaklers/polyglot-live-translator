// Capture réelle vers le moteur local gratuit uniquement.
const LOCAL_WS_URL = "ws://127.0.0.1:47833";
const FREE_ENGINE_ID = "polyglot-local-free-v5";
let socket: WebSocket | null = null;
let recorder: MediaRecorder | null = null;
let stream: MediaStream | null = null;
let audioContext: AudioContext | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
let watchdog: ReturnType<typeof setTimeout> | undefined;
let sequence = 0;
let pending = 0;
let token = "";
let activeTabId: number | null = null;
let generation = 0;
let sending = Promise.resolve();
let delivering = Promise.resolve();
let stopping = false;
let inputMode = "audio";
const sentAt = new Map<number, number>();
let stopReply: (() => void) | undefined;
let stopTask: Promise<void> | undefined;

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.target !== "offscreen") return;
  if (message.type === "offscreen.start") {
    start(message).then(() => sendResponse({ ok: true })).catch((error) => {
      fail(String(error)); sendResponse({ ok: false, error: String(error) });
    });
    return true;
  }
  if (message.type === "offscreen.text") {
    try {
      if (inputMode !== "captions" || stopping || !token || socket?.readyState !== WebSocket.OPEN) throw new Error("Session de sous-titres inactive");
      if (pending >= 6) { const detail = "Le moteur ne suit plus les sous-titres. Mettez la vidéo en pause puis relancez la traduction."; fail(detail); throw new Error(detail); }
      const next = sequence++;
      socket.send(JSON.stringify({...message.cue, type: "text.chunk", token, sequence: next}));
      sentAt.set(next, Date.now()); pending++;
      if (pending === 3) report("Le moteur prend du retard sur les sous-titres : mettez la vidéo en pause.");
      if (pending === 1) watchForReply(generation);
      sendResponse({ok: true});
    } catch (error) { sendResponse({ok: false, error: String(error)}); }
    return;
  }
  if (message.type === "offscreen.stop") {
    finishStop().then(() => sendResponse({ ok: true })).catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }
});

async function start(message: { streamId: string; tabId: number; settings: Record<string, string> }) {
  stop();
  const run = generation;
  activeTabId = message.tabId;
  inputMode = message.settings.inputMode ?? "audio";
  if (inputMode === "audio") {
    const captured = await navigator.mediaDevices.getUserMedia({
      audio: { mandatory: { chromeMediaSource: "tab", chromeMediaSourceId: message.streamId } } as MediaTrackConstraints,
      video: false
    });
    if (generation !== run) { captured.getTracks().forEach((track) => track.stop()); throw new Error("Capture annulée"); }
    stream = captured;
    stream.getTracks().forEach((track) => track.addEventListener("ended", () => { if (generation === run) fail("L’onglet ou le flux audio a été fermé."); }));
    audioContext = new AudioContext();
    audioContext.createMediaStreamSource(stream).connect(audioContext.destination);
    await audioContext.resume();
  }
  const ws = new WebSocket(LOCAL_WS_URL);
  socket = ws;
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Le moteur ne répond pas. Si le démarrage automatique est activé, attendez son chargement et réessayez. Sinon, lancez DEMARRER.cmd.")), 15000);
    const rejectConnection = (detail: string) => { clearTimeout(timeout); reject(new Error(detail)); };
    ws.addEventListener("error", () => rejectConnection("Moteur non connecté. Si le démarrage automatique est activé, attendez son chargement et réessayez. Sinon, lancez DEMARRER.cmd."), { once: true });
    ws.addEventListener("close", () => {
      if (generation !== run) return;
      rejectConnection("Connexion au moteur local fermée.");
      fail("Connexion au moteur local fermée.");
    }, { once: true });
    ws.addEventListener("open", () => {
      ws.send(JSON.stringify({ type: "pair.request", extensionId: chrome.runtime.id }));
    }, { once: true });
    ws.addEventListener("message", (event) => {
      if (generation !== run) return;
      try {
        const response = JSON.parse(String(event.data));
        if (response.type === "pair.accepted") {
          if (response.engine !== FREE_ENGINE_ID) { rejectConnection("Le moteur et l’extension ne sont pas compatibles. Mettez à jour leurs fichiers ensemble, puis relancez le moteur."); return; }
          token = response.token;
          ws.send(JSON.stringify({ type: "session.start", token, options: { ...message.settings, outputMode: undefined, sourceLanguage: message.settings.sourceLanguage ?? "auto", targetLanguage: message.settings.targetLanguage ?? "fr" } }));
        } else if (response.type === "state" && response.state === "capturing") {
          clearTimeout(timeout);
          if (inputMode === "audio") beginSegment(run); report("● Moteur local gratuit — traduction en cours"); resolve();
        } else if (response.type === "pair.rejected" || response.type === "error") {
          const reason = response.reason ?? response.message ?? "Erreur du moteur local";
          const detail = /code.*association/i.test(reason) ? "Un ancien moteur demande encore un code. Mettez à jour le moteur et l’extension ensemble, puis redémarrez le moteur." : reason;
          rejectConnection(detail); fail(detail);
        } else if (response.type === "subtitle") {
          const tabId = activeTabId;
          delivering = delivering.then(async () => {
            if (generation !== run) return;
            await chrome.runtime.sendMessage({ type: "subtitle", tabId, original: response.original, translation: response.translation,
              id: response.id, revision: response.revision, final: response.final, bounded: response.bounded, start: response.start, end: response.end, timing: response.timing, origin: response.origin,
              uncertainWords: response.uncertainWords, sourceLanguage: response.sourceLanguage, targetLanguage: response.targetLanguage }).catch(() => undefined);
          });
        } else if (response.type === "state" && response.state === "stopped") {
          const completed = stopReply;
          delivering.then(() => { if (generation === run) completed?.(); });
        } else if (response.type === "audio.ack") {
          const sent = sentAt.get(response.sequence); sentAt.delete(response.sequence);
          pending = Math.max(0, pending - 1);
          chrome.runtime.sendMessage({type: "capture.metrics", tabId: activeTabId, processingMs: response.processingMs,
            responseMs: sent === undefined ? undefined : Date.now() - sent, pending, inputMode}).catch(() => undefined);
          clearTimeout(watchdog);
          if (pending) watchForReply(run);
        }
      } catch { rejectConnection("Réponse locale invalide"); fail("Réponse locale invalide"); }
    });
  });
}

// Un nouveau MediaRecorder par segment conserve l’en-tête WebM de chaque fichier.
function beginSegment(run: number) {
  if (generation !== run || !stream || stopping) return;
  const currentStream = stream;
  const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "audio/webm";
  const segment = new MediaRecorder(currentStream, { mimeType, audioBitsPerSecond: 64000 });
  recorder = segment;
  segment.addEventListener("dataavailable", (event) => {
    sending = sending.then(async () => {
      if (generation !== run || !event.data.size || socket?.readyState !== WebSocket.OPEN || !token) return;
      if (pending >= 6) { fail("Le moteur local est trop lent pour suivre la vidéo. Mettez la vidéo en pause puis relancez la capture."); return; }
      const data = await blobToBase64(event.data);
      if (generation !== run || socket?.readyState !== WebSocket.OPEN) return;
      const next = sequence++;
      socket.send(JSON.stringify({ type: "audio.chunk", token, sequence: next, mimeType, data }));
      sentAt.set(next, Date.now());
      pending++;
      if (pending === 3) report("Le moteur prend du retard. Réduisez la vitesse de la vidéo si ce message revient.");
      if (pending === 1) watchForReply(run);
    }).catch((error) => { if (generation === run) fail(String(error)); });
  });
  segment.addEventListener("stop", () => { if (generation === run) beginSegment(run); });
  segment.addEventListener("error", () => { if (generation === run) fail("Erreur de capture audio"); });
  segment.start();
  timer = setTimeout(() => { if (segment.state !== "inactive") segment.stop(); }, 3000);
}

function watchForReply(run: number) {
  watchdog = setTimeout(() => { if (generation === run) fail("Le moteur local n’a pas répondu au segment audio depuis deux minutes."); }, 120000);
}

// Arrête immédiatement la collecte, puis laisse le moteur stabiliser le texte
// déjà capturé. Aucune nouvelle voix n'est lancée pendant cette finalisation.
function finishStop(): Promise<void> {
  if (stopTask) return stopTask;
  if (socket?.readyState !== WebSocket.OPEN || !token) { stop(); return Promise.resolve(); }
  stopping = true;
  clearTimeout(timer);
  const run = generation;
  const ws = socket;
  const sessionToken = token;
  stopTask = (async () => {
    if (recorder && recorder.state !== "inactive") {
      await new Promise<void>((resolve) => {
        recorder!.addEventListener("stop", () => resolve(), { once: true });
        recorder!.stop();
      });
    }
    await sending;
    if (generation !== run || ws.readyState !== WebSocket.OPEN) return;
    report("Capture arrêtée — finalisation du dernier texte…");
    await new Promise<void>((resolve) => {
      const deadline = setTimeout(resolve, 15000);
      stopReply = () => { clearTimeout(deadline); resolve(); };
      ws.send(JSON.stringify({ type: "session.stop", token: sessionToken }));
    });
  })().finally(() => { if (generation === run) stop(false); });
  return stopTask;
}

function stop(notify = true) {
  generation++;
  clearTimeout(timer); clearTimeout(watchdog);
  if (recorder && recorder.state !== "inactive") recorder.stop();
  stream?.getTracks().forEach((track) => track.stop());
  if (notify && socket?.readyState === WebSocket.OPEN && token) socket.send(JSON.stringify({ type: "session.stop", token }));
  socket?.close(); audioContext?.close().catch(() => undefined);
  recorder = null; stream = null; socket = null; audioContext = null;
  token = ""; sequence = 0; pending = 0; activeTabId = null; sending = Promise.resolve(); delivering = Promise.resolve();
  stopping = false; sentAt.clear();
  stopReply?.(); stopReply = undefined; stopTask = undefined;
}

function fail(text: string) {
  const tabId = activeTabId;
  stop();
  if (tabId !== null) chrome.runtime.sendMessage({ type: "capture.failed", tabId, text }).catch(() => undefined);
}

function blobToBase64(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function report(text: string) {
  chrome.runtime.sendMessage({ type: "capture.state", tabId: activeTabId, text }).catch(() => undefined);
}
