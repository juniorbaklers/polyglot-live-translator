// Service worker central : coordonne le popup, la capture audio et les sous-titres.
const OFFSCREEN_PATH = "offscreen.html";
import { deliverTranslation, outputMode, stopSpeech } from "./output";

interface ActiveCapture { tabId: number; outputMode: string; targetLanguage: string; stopping?: boolean; }

async function activeCapture(): Promise<ActiveCapture | undefined> {
  return (await chrome.storage.session.get("activeCapture")).activeCapture;
}

// Crée le document invisible seulement s'il n'existe pas déjà.
async function ensureOffscreenDocument() {
  const offscreenUrl = chrome.runtime.getURL(OFFSCREEN_PATH);
  const contexts = await new Promise<chrome.runtime.ExtensionContext[]>((resolve) => {
    chrome.runtime.getContexts(
      { contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT], documentUrls: [offscreenUrl] },
      resolve
    );
  });
  if (contexts.length) return;
  await chrome.offscreen.createDocument({
    url: OFFSCREEN_PATH,
    reasons: [chrome.offscreen.Reason.USER_MEDIA],
    justification: "Capturer le son de l’onglet uniquement après l’action de l’utilisateur"
  });
}

// Oriente chaque message vers la capture, l'arrêt ou l'affichage correspondant.
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "capture.start") {
    let started = false;
    (async () => {
      if (await activeCapture()) throw new Error("Arrêtez la capture actuelle avant d’en démarrer une autre.");
      await ensureOffscreenDocument();
      const streamId = await new Promise<string>((resolve, reject) => {
        chrome.tabCapture.getMediaStreamId({ targetTabId: message.tabId }, (id) => {
          if (chrome.runtime.lastError || !id) reject(new Error(chrome.runtime.lastError?.message ?? "Flux audio indisponible"));
          else resolve(id);
        });
      });
      const settings = await chrome.storage.local.get(["pairingCode", "sourceLanguage", "targetLanguage", "outputMode"]);
      stopSpeech();
      await chrome.storage.session.remove("captureError");
      await chrome.storage.session.set({ activeCapture: { tabId: message.tabId, outputMode: outputMode(settings.outputMode), targetLanguage: settings.targetLanguage ?? "fr" } });
      started = true;
      await chrome.tabs.sendMessage(message.tabId, { type: "overlay.show", text: "Connexion au moteur local gratuit…" });
      const response = await chrome.runtime.sendMessage({ type: "offscreen.start", target: "offscreen", streamId, tabId: message.tabId, settings });
      if (!response?.ok) throw new Error(response?.error ?? "Connexion locale impossible");
      await chrome.action.setBadgeText({ text: "REC", tabId: message.tabId });
      await chrome.action.setBadgeBackgroundColor({ color: "#c52e40", tabId: message.tabId });
      sendResponse({ ok: true });
    })().catch(async (error) => {
      if (started) {
        await chrome.storage.session.remove("activeCapture");
        stopSpeech();
        await chrome.runtime.sendMessage({ type: "offscreen.stop", target: "offscreen" }).catch(() => undefined);
        await chrome.action.setBadgeText({ text: "", tabId: message.tabId });
      }
      sendResponse({ ok: false, error: String(error) });
    });
    return true;
  }
  if (message.type === "capture.stop") {
    (async () => {
      const active = await activeCapture();
      const tabId = active?.tabId ?? message.tabId;
      if (active) await chrome.storage.session.set({ activeCapture: { ...active, stopping: true } });
      stopSpeech();
      await chrome.runtime.sendMessage({ type: "offscreen.stop", target: "offscreen" });
      await chrome.storage.session.remove("activeCapture");
      await chrome.action.setBadgeText({ text: "", tabId });
      await chrome.tabs.sendMessage(tabId, { type: "overlay.stopped" }).catch(() => undefined);
      sendResponse({ ok: true });
    })().catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }
  if (message.type === "output.change") {
    (async () => {
      const mode = outputMode(message.outputMode);
      await chrome.storage.local.set({ outputMode: mode });
      stopSpeech();
      const active = await activeCapture();
      if (active) {
        await chrome.storage.session.set({ activeCapture: { ...active, outputMode: mode } });
        await chrome.tabs.sendMessage(active.tabId, { type: "overlay.mode", outputMode: mode }).catch(() => undefined);
      }
      sendResponse({ ok: true });
    })().catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }
  if (message.type === "capture.failed") {
    (async () => {
      const active = await activeCapture();
      if (!active || active.tabId !== message.tabId) return;
      await chrome.storage.session.remove("activeCapture");
      await chrome.storage.session.set({ captureError: message.text });
      stopSpeech();
      await chrome.action.setBadgeText({ text: "", tabId: active.tabId });
      await chrome.tabs.sendMessage(active.tabId, { type: "overlay.error", text: message.text }).catch(() => undefined);
    })().catch(() => undefined);
  }
  if (message.type === "capture.state" && message.tabId) {
    chrome.tabs.sendMessage(message.tabId, { type: "overlay.show", text: message.text }).catch(() => undefined);
  }
  if (message.type === "subtitle" && message.tabId) {
    (async () => {
      const active = await activeCapture();
      if (!active || active.tabId !== message.tabId) { sendResponse({ ok: false }); return; }
      await deliverTranslation(active.tabId, outputMode(active.outputMode), active.targetLanguage, message.original, message.translation,
        { id: message.id, revision: message.revision, final: message.final, bounded: message.bounded }, !active.stopping);
      sendResponse({ ok: true });
    })().catch(() => sendResponse({ ok: false }));
    return true;
  }
});
