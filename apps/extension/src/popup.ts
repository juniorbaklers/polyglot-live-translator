import { outputMode } from "./output";

const state = document.querySelector<HTMLDivElement>("#state")!;
const capture = document.querySelector<HTMLButtonElement>("#capture")!;
const reveal = document.querySelector<HTMLButtonElement>("#reveal")!;
const output = document.querySelector<HTMLSelectElement>("#output")!;
const source = document.querySelector<HTMLSelectElement>("#source")!;
const target = document.querySelector<HTMLSelectElement>("#target")!;
const inputMode = document.querySelector<HTMLSelectElement>("#input-mode")!;
const domain = document.querySelector<HTMLSelectElement>("#domain")!;
const glossary = document.querySelector<HTMLTextAreaElement>("#glossary")!;
const preferenceKeys = ["inputMode", "domain", "glossary", "corrections"];
let capturing = false;
let captureTabId: number | undefined;

function updateButton() {
  capture.textContent = capturing ? "Arrêter la traduction" : "Démarrer la traduction";
  capture.classList.toggle("stop", capturing);
  source.disabled = target.disabled = inputMode.disabled = domain.disabled = glossary.disabled = capturing;
  document.querySelector<HTMLButtonElement>("#save-preferences")!.disabled = capturing;
}

capture.disabled = output.disabled = reveal.disabled = true;
async function restore() {
  const settings = await chrome.storage.local.get(["sourceLanguage", "targetLanguage", "outputMode", ...preferenceKeys]);
  const { activeCapture, captureError } = await chrome.storage.session.get(["activeCapture", "captureError"]);
  source.value = settings.sourceLanguage ?? "auto";
  target.value = settings.targetLanguage ?? "fr";
  inputMode.value = settings.inputMode ?? "audio";
  domain.value = settings.domain ?? "general";
  glossary.value = settings.glossary ?? "";
  renderCorrections(settings.corrections ?? []);
  output.value = outputMode(activeCapture?.outputMode ?? settings.outputMode);
  capturing = Boolean(activeCapture);
  captureTabId = activeCapture?.tabId;
  updateButton();
  showState(capturing ? "Traduction active. Utilisez Afficher la fenêtre si elle est masquée." : captureError ?? "Moteur automatique activé ? Cliquez sur Démarrer. Sinon, lancez DEMARRER.cmd.", Boolean(captureError));
}
restore().catch((error) => { state.textContent = String(error); }).finally(() => {
  capture.disabled = output.disabled = reveal.disabled = false;
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
  if (area === "local" && changes.corrections) renderCorrections(changes.corrections.newValue ?? []);
  if (area === "local" && changes.outputMode) output.value = outputMode(changes.outputMode.newValue);
});

output.addEventListener("change", async () => {
  try {
    const response = await chrome.runtime.sendMessage({ type: "output.change", outputMode: output.value });
    if (!response?.ok) throw new Error(response?.error ?? "Choix non enregistré");
    state.textContent = capturing ? "Mode modifié — appliqué aux prochaines traductions" : "Mode de traduction enregistré";
  } catch (error) { state.textContent = String(error); }
});

capture.addEventListener("click", async () => {
  capture.disabled = true;
  const starting = !capturing;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const tabId = starting ? tab?.id : captureTabId;
    if (tabId === undefined) throw new Error("Onglet actif introuvable.");
    if (starting) {
      showState("Ouverture de la fenêtre et connexion au moteur…");
      await chrome.storage.local.set({ sourceLanguage: source.value, targetLanguage: target.value, outputMode: outputMode(output.value), inputMode: inputMode.value, domain: domain.value, glossary: glossary.value.trim() });
    }
    const response = await chrome.runtime.sendMessage({ type: starting ? "capture.start" : "capture.stop", tabId });
    if (!response?.ok) throw new Error(response?.error ?? "La capture n’a pas démarré");
    capturing = starting;
    captureTabId = capturing ? tabId : undefined;
    updateButton();
    showState(capturing ? "Traduction démarrée. La fenêtre est sur la page vidéo." : "Traduction arrêtée.");
  } catch (error) { showState(String(error).replace(/^Error: /, ""), true); }
  finally { capture.disabled = false; }
});

function renderCorrections(items: {original: string; translation: string; source: string; target: string}[]) {
  document.querySelector("#correction-count")!.textContent = `Corrections locales (${items.length}/100)`;
  const list = document.querySelector("#correction-list")!; list.replaceChildren();
  items.slice(-10).forEach(item => { const line = document.createElement("p"); line.className = "hint"; line.textContent = `${item.source} → ${item.target} : ${item.original} → ${item.translation}`; list.append(line); });
}
document.querySelector<HTMLButtonElement>("#save-preferences")!.onclick = async () => {
  await chrome.storage.local.set({inputMode: inputMode.value, domain: domain.value, glossary: glossary.value.trim()});
  state.textContent = "Réglages enregistrés pour la prochaine session.";
};
document.querySelector<HTMLButtonElement>("#clear-corrections")!.onclick = async () => {
  if (!confirm("Effacer toutes les corrections locales ?")) return;
  await chrome.storage.local.set({corrections: []});
  state.textContent = "Corrections effacées. Redémarrez la traduction pour appliquer.";
};

inputMode.addEventListener("change", updateButton);

function showState(text: string, error = false) { state.textContent = text; state.classList.toggle("error", error); }
reveal.addEventListener("click", async () => {
  reveal.disabled = true;
  try {
    const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
    const tabId = captureTabId ?? tab?.id;
    if (tabId === undefined) throw new Error("Ouvrez d’abord la page de votre vidéo.");
    const response = await chrome.runtime.sendMessage({type: "overlay.reveal", tabId});
    if (!response?.ok) throw new Error(response?.error ?? "Affichage impossible. Actualisez la page vidéo.");
    showState(response.active ? "Fenêtre réaffichée sur l’onglet de traduction." : "Fenêtre affichée. Cliquez sur Démarrer pour traduire.");
    if (response.outputMode) output.value = response.outputMode;
  } catch (error) { showState(String(error).replace(/^Error: /, ""), true); }
  finally { reveal.disabled = false; }
});
