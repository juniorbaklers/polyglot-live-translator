// Capture réelle vers le moteur local gratuit uniquement.
const LOCAL_WS_URL = "ws://127.0.0.1:47833";
const FREE_ENGINE_ID = "polyglot-local-free-v1";
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

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.target !== "offscreen") return;
  if (message.type === "offscreen.start") {
    start(message).then(() => sendResponse({ ok: true })).catch((error) => {
      fail(String(error)); sendResponse({ ok: false, error: String(error) });
    });
    return true;
  }
  if (message.type === "offscreen.stop") { stop(); sendResponse({ ok: true }); }
});

async function start(message: { streamId: string; tabId: number; settings: Record<string, string> }) {
  stop();
  const run = generation;
  activeTabId = message.tabId;
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
  const ws = new WebSocket(LOCAL_WS_URL);
  socket = ws;
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Le moteur local ne répond pas. Lancez DEMARRER.cmd.")), 15000);
    const rejectConnection = (detail: string) => { clearTimeout(timeout); reject(new Error(detail)); };
    ws.addEventListener("error", () => rejectConnection("Moteur local absent. Lancez DEMARRER.cmd puis copiez son code."), { once: true });
    ws.addEventListener("close", () => {
      if (generation !== run) return;
      rejectConnection("Connexion au moteur local fermée.");
      fail("Connexion au moteur local fermée.");
    }, { once: true });
    ws.addEventListener("open", () => {
      ws.send(JSON.stringify({ type: "pair.request", code: message.settings.pairingCode ?? "", extensionId: chrome.runtime.id }));
    }, { once: true });
    ws.addEventListener("message", (event) => {
      if (generation !== run) return;
      try {
        const response = JSON.parse(String(event.data));
        if (response.type === "pair.accepted") {
          if (response.engine !== FREE_ENGINE_ID) { rejectConnection("Ce service n’est pas le moteur local gratuit autorisé."); return; }
          token = response.token;
          ws.send(JSON.stringify({ type: "session.start", token, options: { sourceLanguage: message.settings.sourceLanguage ?? "auto", targetLanguage: message.settings.targetLanguage ?? "fr" } }));
        } else if (response.type === "state" && response.state === "capturing") {
          clearTimeout(timeout);
          beginSegment(run); report("● Moteur local gratuit — traduction en cours"); resolve();
        } else if (response.type === "pair.rejected" || response.type === "error") {
          const detail = response.reason ?? response.message ?? "Erreur du moteur local";
          rejectConnection(detail); fail(detail);
        } else if (response.type === "subtitle") {
          chrome.runtime.sendMessage({ type: "subtitle", tabId: activeTabId, original: response.original, translation: response.translation }).catch(() => undefined);
        } else if (response.type === "audio.ack") {
          pending = Math.max(0, pending - 1);
          clearTimeout(watchdog);
          if (pending) watchForReply(run);
        }
      } catch { rejectConnection("Réponse locale invalide"); fail("Réponse locale invalide"); }
    });
  });
}

// Un nouveau MediaRecorder par segment conserve l’en-tête WebM de chaque fichier.
function beginSegment(run: number) {
  if (generation !== run || !stream) return;
  const currentStream = stream;
  const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "audio/webm";
  const segment = new MediaRecorder(currentStream, { mimeType, audioBitsPerSecond: 64000 });
  recorder = segment;
  segment.addEventListener("dataavailable", (event) => {
    sending = sending.then(async () => {
      if (generation !== run || !event.data.size || socket?.readyState !== WebSocket.OPEN || !token) return;
      if (pending >= 3) { fail("Le moteur local est trop lent pour suivre la vidéo. Mettez la vidéo en pause puis relancez la capture."); return; }
      const data = await blobToBase64(event.data);
      if (generation !== run || socket?.readyState !== WebSocket.OPEN) return;
      socket.send(JSON.stringify({ type: "audio.chunk", token, sequence: sequence++, mimeType, data }));
      pending++;
      if (pending === 1) watchForReply(run);
    }).catch((error) => { if (generation === run) fail(String(error)); });
  });
  segment.addEventListener("stop", () => { if (generation === run) beginSegment(run); });
  segment.addEventListener("error", () => { if (generation === run) fail("Erreur de capture audio"); });
  segment.start();
  timer = setTimeout(() => { if (segment.state !== "inactive") segment.stop(); }, 5000);
}

function watchForReply(run: number) {
  watchdog = setTimeout(() => { if (generation === run) fail("Le moteur local n’a pas répondu au segment audio depuis deux minutes."); }, 120000);
}

function stop() {
  generation++;
  clearTimeout(timer); clearTimeout(watchdog);
  if (recorder && recorder.state !== "inactive") recorder.stop();
  stream?.getTracks().forEach((track) => track.stop());
  if (socket?.readyState === WebSocket.OPEN && token) socket.send(JSON.stringify({ type: "session.stop", token }));
  socket?.close(); audioContext?.close().catch(() => undefined);
  recorder = null; stream = null; socket = null; audioContext = null;
  token = ""; sequence = 0; pending = 0; activeTabId = null; sending = Promise.resolve();
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
