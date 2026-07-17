const ID = "polyglot-live-subtitles";

function show(text: string) {
  let overlay = document.getElementById(ID);
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = ID;
    Object.assign(overlay.style, { position: "fixed", left: "50%", bottom: "9%", transform: "translateX(-50%)", zIndex: "2147483647", maxWidth: "80vw", padding: "12px 18px", borderRadius: "10px", color: "white", background: "rgba(8,18,38,.82)", font: "600 20px/1.4 Segoe UI,sans-serif", textAlign: "center", pointerEvents: "none" });
    document.documentElement.appendChild(overlay);
  }
  overlay.textContent = text;
}

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "overlay.show") show(message.text);
  if (message.type === "overlay.subtitle") show(message.translation);
  if (message.type === "overlay.hide") document.getElementById(ID)?.remove();
});
