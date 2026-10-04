// Service worker central : coordonne le popup, la capture audio et les sous-titres.
const OFFSCREEN_PATH = "offscreen.html";
import { deliverTranslation, outputMode, stopSpeech } from "./output";

interface ActiveCapture { tabId: number; outputMode: string; targetLanguage: string; stopping?: boolean; inputMode?: string; }

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

async function ensureContent(tabId: number) {
  const tab = await chrome.tabs.get(tabId);
  if (!/^https?:\/\//.test(tab.url ?? "")) throw new Error("Ouvrez la page web de la vidéo. Cette page du navigateur ne peut pas afficher la traduction.");
  let response;
  try { response = await chrome.tabs.sendMessage(tabId, {type: "overlay.ping"}); }
  catch {
    try { await chrome.scripting.executeScript({target: {tabId}, files: ["content.js"]}); }
    catch { throw new Error("La fenêtre ne peut pas être ajoutée à cette page. Actualisez la vidéo et vérifiez l’accès de l’extension à ce site."); }
    response = await chrome.tabs.sendMessage(tabId, {type: "overlay.ping"});
  }
  if (!response?.ok || response.version !== "1.3.1") throw new Error("Actualisez la page vidéo pour charger la nouvelle fenêtre de traduction.");
}

// Oriente chaque message vers la capture, l'arrêt ou l'affichage correspondant.
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "capture.start") {
    let started = false;
    (async () => {
      if (await activeCapture()) throw new Error("Arrêtez la capture actuelle avant d’en démarrer une autre.");
      await ensureContent(message.tabId);
      await ensureOffscreenDocument();
      const settings = await chrome.storage.local.get(["pairingCode", "sourceLanguage", "targetLanguage", "outputMode", "inputMode", "domain", "glossary", "corrections"]);
      const streamId = settings.inputMode === "captions" ? "" : await new Promise<string>((resolve, reject) => {
        chrome.tabCapture.getMediaStreamId({ targetTabId: message.tabId }, (id) => {
          if (chrome.runtime.lastError || !id) reject(new Error(chrome.runtime.lastError?.message ?? "Flux audio indisponible"));
          else resolve(id);
        });
      });
      stopSpeech();
      await chrome.storage.session.remove("captureError");
      await chrome.storage.session.set({ activeCapture: { tabId: message.tabId, outputMode: outputMode(settings.outputMode), targetLanguage: settings.targetLanguage ?? "fr", inputMode: settings.inputMode ?? "audio" } });
      started = true;
      await chrome.tabs.sendMessage(message.tabId, { type: "overlay.show", text: "Connexion au moteur local gratuit…" });
      const response = await chrome.runtime.sendMessage({ type: "offscreen.start", target: "offscreen", streamId, tabId: message.tabId, settings });
      if (!response?.ok) throw new Error(response?.error ?? "Connexion locale impossible");
      if (settings.inputMode === "captions") {
        const captions = await chrome.tabs.sendMessage(message.tabId, { type: "captions.start", sourceLanguage: settings.sourceLanguage });
        if (!captions?.ok) throw new Error(captions?.error ?? "Sous-titres accessibles introuvables");
      }
      await chrome.action.setBadgeText({ text: settings.inputMode === "captions" ? "TXT" : "REC", tabId: message.tabId });
      await chrome.action.setBadgeBackgroundColor({ color: "#c52e40", tabId: message.tabId });
      sendResponse({ ok: true });
    })().catch(async (error) => {
      if (started) {
        await chrome.tabs.sendMessage(message.tabId, { type: "captions.stop" }).catch(() => undefined);
        await chrome.storage.session.remove("activeCapture");
        stopSpeech();
        await chrome.runtime.sendMessage({ type: "offscreen.stop", target: "offscreen" }).catch(() => undefined);
        await chrome.action.setBadgeText({ text: "", tabId: message.tabId });
      }
      await chrome.tabs.sendMessage(message.tabId, {type: "overlay.error", text: String(error)}).catch(() => undefined);
      sendResponse({ ok: false, error: String(error) });
    });
    return true;
  }
  if (message.type === "overlay.reveal") {
    (async () => {
      const active = await activeCapture();
      const tabId = active?.tabId ?? message.tabId;
      if (!Number.isInteger(tabId)) throw new Error("Onglet vidéo introuvable.");
      await ensureContent(tabId);
      let mode = active?.outputMode;
      if (mode === "voice") {
        mode = "both";
        await chrome.storage.local.set({outputMode: mode});
        await chrome.storage.session.set({activeCapture: {...active, outputMode: mode}});
        await chrome.tabs.sendMessage(tabId, {type: "overlay.mode", outputMode: mode});
      }
      const response = await chrome.tabs.sendMessage(tabId, {type: "overlay.reveal", active: Boolean(active && !active.stopping)});
      if (!response?.ok) throw new Error("Fenêtre indisponible. Actualisez la page vidéo.");
      await chrome.tabs.update(tabId, {active: true});
      sendResponse({ok: true, active: Boolean(active), outputMode: mode});
    })().catch(error => sendResponse({ok: false, error: String(error)}));
    return true;
  }
  if (message.type === "capture.stop") {
    (async () => {
      const active = await activeCapture();
      const tabId = active?.tabId ?? message.tabId;
      if (active) await chrome.storage.session.set({ activeCapture: { ...active, stopping: true } });
      stopSpeech();
      await chrome.tabs.sendMessage(tabId, { type: "captions.stop" }).catch(() => undefined);
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
  if (message.type === "caption.cue") {
    (async () => {
      const active = await activeCapture();
      if (!active || active.stopping || active.inputMode !== "captions" || _sender.tab?.id !== active.tabId) throw new Error("Session de sous-titres inactive");
      const response = await chrome.runtime.sendMessage({type: "offscreen.text", target: "offscreen", cue: message.cue});
      sendResponse(response);
    })().catch(error => sendResponse({ok: false, error: String(error)}));
    return true;
  }
  if (message.type === "correction.save") {
    (async () => {
      if (!_sender.tab) throw new Error("Correction disponible depuis les sous-titres");
      const item = message.correction;
      if (!item || !["en", "fr", "es"].includes(item.source) || !["en", "fr", "es"].includes(item.target) ||
          typeof item.original !== "string" || typeof item.translation !== "string" || !item.original.trim() || !item.translation.trim() || item.original.length > 2000 || item.translation.length > 2000) throw new Error("Correction invalide");
      const settings = await chrome.storage.local.get("corrections");
      const items = (settings.corrections ?? []).filter((old: typeof item) => !(old.source === item.source && old.target === item.target && old.original.trim().toLowerCase() === item.original.trim().toLowerCase()));
      if (items.length >= 100) throw new Error("100 corrections enregistrées. Effacez-en depuis le popup.");
      items.push({original: item.original.trim(), translation: item.translation.trim(), source: item.source, target: item.target});
      await chrome.storage.local.set({corrections: items});
      sendResponse({ok: true});
    })().catch(error => sendResponse({ok: false, error: String(error)}));
    return true;
  }
  if (message.type === "capture.metrics" && message.tabId) {
    chrome.tabs.sendMessage(message.tabId, {...message, tabId: undefined, type: "overlay.metrics"}).catch(() => undefined);
  }
  if (message.type === "capture.failed") {
    (async () => {
      const active = await activeCapture();
      if (!active || active.tabId !== message.tabId) return;
      await chrome.tabs.sendMessage(active.tabId, { type: "captions.stop" }).catch(() => undefined);
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
        { id: message.id, revision: message.revision, final: message.final, bounded: message.bounded, start: message.start, end: message.end, timing: message.timing, origin: message.origin, uncertainWords: message.uncertainWords, sourceLanguage: message.sourceLanguage, targetLanguage: message.targetLanguage }, !active.stopping);
      sendResponse({ ok: true });
    })().catch(() => sendResponse({ ok: false }));
    return true;
  }
});
