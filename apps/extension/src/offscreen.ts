const LOCAL_WS_URL = "ws://127.0.0.1:47832";
let socket: WebSocket | null = null;
let recorder: MediaRecorder | null = null;
let stream: MediaStream | null = null;
let sequence = 0;
let token = "";
let activeTabId: number | null = null;

chrome.runtime.onMessage.addListener((message) => {
  if (message.target !== "offscreen") return;
  if (message.type === "offscreen.start") start(message).catch((error) => report(`Erreur : ${String(error)}`));
  if (message.type === "offscreen.stop") stop();
});

async function start(message: { streamId: string; tabId: number; settings: Record<string, string> }) {
  stop();
  activeTabId = message.tabId;
  stream = await navigator.mediaDevices.getUserMedia({
    audio: { mandatory: { chromeMediaSource: "tab", chromeMediaSourceId: message.streamId } } as MediaTrackConstraints,
    video: false
  });
  const audioContext = new AudioContext();
  audioContext.createMediaStreamSource(stream).connect(audioContext.destination);
  socket = new WebSocket(LOCAL_WS_URL);
  await waitForSocket(socket);
  socket.send(JSON.stringify({ type: "pair.request", code: message.settings.pairingCode ?? "", extensionId: chrome.runtime.id }));
  socket.addEventListener("message", (event) => {
    const response = JSON.parse(String(event.data));
    if (response.type === "pair.accepted") {
      token = response.token;
      socket?.send(JSON.stringify({ type: "session.start", token, options: { sourceLanguage: message.settings.sourceLanguage ?? "auto", targetLanguage: message.settings.targetLanguage ?? "fr", showOriginal: true, speechOutput: false } }));
      beginRecording();
      report("● Capture de l’onglet en cours");
    }
    if (response.type === "pair.rejected" || response.type === "error") report(response.reason ?? response.message);
    if (response.type === "subtitle") {
      chrome.runtime.sendMessage({ type: "subtitle", tabId: activeTabId, original: response.original, translation: response.translation }).catch(() => undefined);
    }
  });
}

function beginRecording() {
  if (!stream) return;
  const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "audio/webm";
  recorder = new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 64_000 });
  recorder.addEventListener("dataavailable", async (event) => {
    if (!event.data.size || socket?.readyState !== WebSocket.OPEN || !token) return;
    const data = await blobToBase64(event.data);
    socket.send(JSON.stringify({ type: "audio.chunk", token, sequence: sequence++, mimeType, data }));
  });
  recorder.start(1000);
}

function stop() {
  if (recorder?.state !== "inactive") recorder?.stop();
  stream?.getTracks().forEach((track) => track.stop());
  if (socket?.readyState === WebSocket.OPEN && token) socket.send(JSON.stringify({ type: "session.stop", token }));
  socket?.close();
  recorder = null; stream = null; socket = null; token = ""; sequence = 0; activeTabId = null;
}

function waitForSocket(ws: WebSocket) {
  return new Promise<void>((resolve, reject) => {
    ws.addEventListener("open", () => resolve(), { once: true });
    ws.addEventListener("error", () => reject(new Error("Application Windows non détectée sur 127.0.0.1")), { once: true });
  });
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
