const ID = "polyglot-live-subtitles";

function ensureOverlay() {
  let overlay = document.getElementById(ID);
  if (overlay) return overlay;
  overlay = document.createElement("div");
  overlay.id = ID;
  overlay.innerHTML = `<div data-role="handle">Polyglot Live <button data-role="close" title="Masquer">×</button></div><div data-role="original"></div><div data-role="translation"></div>`;
  Object.assign(overlay.style, { position: "fixed", left: "50%", bottom: "8%", transform: "translateX(-50%)", zIndex: "2147483647", width: "min(820px,80vw)", minWidth: "280px", resize: "both", overflow: "auto", padding: "8px 16px 14px", borderRadius: "12px", color: "white", background: "rgba(8,18,38,.86)", font: "600 20px/1.4 Segoe UI,sans-serif", textAlign: "center", boxShadow: "0 12px 35px rgba(0,0,0,.32)" });
  const handle = overlay.querySelector<HTMLElement>('[data-role="handle"]')!;
  Object.assign(handle.style, { cursor: "move", fontSize: "11px", color: "#aebedf", textAlign: "left", userSelect: "none" });
  const close = overlay.querySelector<HTMLButtonElement>('[data-role="close"]')!;
  Object.assign(close.style, { float: "right", border: "0", background: "transparent", color: "white", cursor: "pointer", fontSize: "18px" });
  close.addEventListener("click", () => overlay?.remove());
  makeDraggable(overlay, handle);
  document.documentElement.appendChild(overlay);
  return overlay;
}

function showState(text: string) {
  const overlay = ensureOverlay();
  const original = overlay.querySelector<HTMLElement>('[data-role="original"]')!;
  const translation = overlay.querySelector<HTMLElement>('[data-role="translation"]')!;
  original.textContent = "";
  translation.textContent = text;
}

function showSubtitle(originalText: string, translatedText: string) {
  const overlay = ensureOverlay();
  const original = overlay.querySelector<HTMLElement>('[data-role="original"]')!;
  const translation = overlay.querySelector<HTMLElement>('[data-role="translation"]')!;
  original.textContent = originalText;
  translation.textContent = translatedText;
  Object.assign(original.style, { fontSize: "15px", color: "#c7d4eb", marginTop: "4px" });
  Object.assign(translation.style, { fontSize: "22px", color: "#ffffff", marginTop: "4px" });
}

function makeDraggable(element: HTMLElement, handle: HTMLElement) {
  let offsetX = 0, offsetY = 0, dragging = false;
  handle.addEventListener("mousedown", (event) => {
    dragging = true;
    const rect = element.getBoundingClientRect();
    offsetX = event.clientX - rect.left; offsetY = event.clientY - rect.top;
    element.style.transform = "none";
  });
  document.addEventListener("mousemove", (event) => {
    if (!dragging) return;
    element.style.left = `${Math.max(0, event.clientX - offsetX)}px`;
    element.style.top = `${Math.max(0, event.clientY - offsetY)}px`;
    element.style.bottom = "auto";
  });
  document.addEventListener("mouseup", () => { dragging = false; });
}

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "overlay.show") showState(message.text);
  if (message.type === "overlay.subtitle") showSubtitle(message.original, message.translation);
  if (message.type === "overlay.hide") document.getElementById(ID)?.remove();
});
