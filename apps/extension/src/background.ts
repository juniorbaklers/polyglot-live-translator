// Service worker central : coordonne le popup, la capture audio et les sous-titres.
const OFFSCREEN_PATH = "offscreen.html";

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
    (async () => {
      await ensureOffscreenDocument();
      const streamId = await new Promise<string>((resolve, reject) => {
        chrome.tabCapture.getMediaStreamId({ targetTabId: message.tabId }, (id) => {
          if (chrome.runtime.lastError || !id) reject(new Error(chrome.runtime.lastError?.message ?? "Flux audio indisponible"));
          else resolve(id);
        });
      });
      const settings = await chrome.storage.local.get(["pairingCode", "sourceLanguage", "targetLanguage"]);
      await chrome.runtime.sendMessage({ type: "offscreen.start", target: "offscreen", streamId, tabId: message.tabId, settings });
      await chrome.action.setBadgeText({ text: "REC", tabId: message.tabId });
      await chrome.action.setBadgeBackgroundColor({ color: "#c52e40", tabId: message.tabId });
      await chrome.tabs.sendMessage(message.tabId, { type: "overlay.show", text: "Connexion à l’application Windows…" });
      sendResponse({ ok: true });
    })().catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }
  if (message.type === "capture.stop") {
    (async () => {
      await chrome.runtime.sendMessage({ type: "offscreen.stop", target: "offscreen" });
      await chrome.action.setBadgeText({ text: "", tabId: message.tabId });
      await chrome.tabs.sendMessage(message.tabId, { type: "overlay.hide" });
      sendResponse({ ok: true });
    })().catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }
  if (message.type === "capture.state" && message.tabId) {
    chrome.tabs.sendMessage(message.tabId, { type: "overlay.show", text: message.text }).catch(() => undefined);
  }
  if (message.type === "subtitle" && message.tabId) {
    chrome.tabs.sendMessage(message.tabId, { type: "overlay.subtitle", original: message.original, translation: message.translation }).catch(() => undefined);
  }
});
