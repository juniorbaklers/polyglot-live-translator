import { outputMode } from "./output";

const state = document.querySelector<HTMLDivElement>("#state")!;
const capture = document.querySelector<HTMLButtonElement>("#capture")!;
const pair = document.querySelector<HTMLButtonElement>("#pair")!;
const output = document.querySelector<HTMLSelectElement>("#output")!;
const source = document.querySelector<HTMLSelectElement>("#source")!;
const target = document.querySelector<HTMLSelectElement>("#target")!;
const codeInput = document.querySelector<HTMLInputElement>("#code")!;
let capturing = false;
let captureTabId: number | undefined;

function updateButton() {
  capture.textContent = capturing ? "Arrêter la capture" : "Capturer le son de cet onglet";
  capture.classList.toggle("stop", capturing);
  source.disabled = target.disabled = capturing;
}

capture.disabled = output.disabled = true;
async function restore() {
  const settings = await chrome.storage.local.get(["pairingCode", "sourceLanguage", "targetLanguage", "outputMode"]);
  const { activeCapture, captureError } = await chrome.storage.session.get(["activeCapture", "captureError"]);
  codeInput.value = settings.pairingCode ?? "";
  source.value = settings.sourceLanguage ?? "auto";
  target.value = settings.targetLanguage ?? "fr";
  output.value = outputMode(activeCapture?.outputMode ?? settings.outputMode);
  capturing = Boolean(activeCapture);
  captureTabId = activeCapture?.tabId;
  updateButton();
  state.textContent = capturing ? "● Capture en cours" : captureError ?? "Lancez DEMARRER.cmd puis saisissez son code.";
}
restore().catch((error) => { state.textContent = String(error); }).finally(() => {
  capture.disabled = output.disabled = false;
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "session" && changes.activeCapture) {
    const active = changes.activeCapture.newValue;
    capturing = Boolean(active);
    captureTabId = active?.tabId;
    updateButton();
    state.textContent = capturing ? "● Connexion au moteur local" : "Capture interrompue";
  }
  if (area === "session" && changes.captureError?.newValue) state.textContent = changes.captureError.newValue;
  if (area === "local" && changes.outputMode) output.value = outputMode(changes.outputMode.newValue);
});

output.addEventListener("change", async () => {
  try {
    const response = await chrome.runtime.sendMessage({ type: "output.change", outputMode: output.value });
    if (!response?.ok) throw new Error(response?.error ?? "Choix non enregistré");
    state.textContent = capturing ? "Mode modifié — appliqué aux prochaines traductions" : "Mode de traduction enregistré";
  } catch (error) { state.textContent = String(error); }
});

pair.addEventListener("click", async () => {
  const code = codeInput.value.trim();
  if (!/^\d{6}$/.test(code)) { state.textContent = "Saisissez le code à 6 chiffres."; return; }
  await chrome.storage.local.set({ pairingCode: code });
  state.textContent = "Code enregistré — connexion locale en attente";
});

capture.addEventListener("click", async () => {
  capture.disabled = true;
  const starting = !capturing;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const tabId = starting ? tab?.id : captureTabId;
    if (tabId === undefined) throw new Error("Onglet actif introuvable.");
    if (starting) {
      await chrome.storage.local.set({ sourceLanguage: source.value, targetLanguage: target.value, outputMode: outputMode(output.value) });
    }
    const response = await chrome.runtime.sendMessage({ type: starting ? "capture.start" : "capture.stop", tabId });
    if (!response?.ok) throw new Error(response?.error ?? "La capture n’a pas démarré");
    capturing = starting;
    captureTabId = capturing ? tabId : undefined;
    updateButton();
    state.textContent = capturing ? "● Connexion et capture en cours" : "Capture interrompue";
  } catch (error) { state.textContent = String(error); }
  finally { capture.disabled = false; }
});
