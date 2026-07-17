chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "capture.start") {
    chrome.action.setBadgeText({ text: "REC", tabId: message.tabId });
    chrome.action.setBadgeBackgroundColor({ color: "#c52e40", tabId: message.tabId });
    chrome.tabs.sendMessage(message.tabId, { type: "overlay.show", text: "Connexion à l’application Windows…" });
    sendResponse({ ok: true });
  }
  if (message.type === "capture.stop") {
    chrome.action.setBadgeText({ text: "", tabId: message.tabId });
    chrome.tabs.sendMessage(message.tabId, { type: "overlay.hide" });
    sendResponse({ ok: true });
  }
  return true;
});
