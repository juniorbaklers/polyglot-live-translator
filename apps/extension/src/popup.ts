import { outputMode } from "./output";
import { builtinTerms } from "./builtin_terms";

const state = document.querySelector<HTMLDivElement>("#state")!;
const capture = document.querySelector<HTMLButtonElement>("#capture")!;
const reveal = document.querySelector<HTMLButtonElement>("#reveal")!;
const output = document.querySelector<HTMLSelectElement>("#output")!;
const source = document.querySelector<HTMLSelectElement>("#source")!;
const target = document.querySelector<HTMLSelectElement>("#target")!;
const inputMode = document.querySelector<HTMLSelectElement>("#input-mode")!;
const domain = document.querySelector<HTMLSelectElement>("#domain")!;
const glossary = document.querySelector<HTMLTextAreaElement>("#glossary")!;
const muteOriginal = document.querySelector<HTMLInputElement>("#mute-original")!;
const recognitionQuality = document.querySelector<HTMLSelectElement>("#recognition-quality")!;
const translationEngine = document.querySelector<HTMLSelectElement>("#translation-engine")!;
const expert = document.querySelector<HTMLSelectElement>("#expert")!;
const aiModel = document.querySelector<HTMLInputElement>("#ai-model")!;
const expertPrompt = document.querySelector<HTMLTextAreaElement>("#expert-prompt")!;
const voiceEngine = document.querySelector<HTMLSelectElement>("#voice-engine")!;
const voiceRate = document.querySelector<HTMLSelectElement>("#voice-rate")!;
const terminology = document.querySelector<HTMLTextAreaElement>("#terminology")!;
const newKeys = ["translationEngine", "expert", "aiModel", "expertPrompt", "voiceEngine", "voiceRate", "terminology"];
const preferenceKeys = ["inputMode", "domain", "glossary", "corrections", "muteOriginal", "recognitionQuality", ...newKeys];
let capturing = false;
let captureTabId: number | undefined;

function updateButton() {
  capture.textContent = capturing ? "Arrêter la traduction" : "Démarrer la traduction";
  capture.classList.toggle("stop", capturing);
  source.disabled = target.disabled = inputMode.disabled = domain.disabled = glossary.disabled = capturing;
  recognitionQuality.disabled = capturing;
  [translationEngine, expert, aiModel, expertPrompt, voiceEngine, voiceRate, terminology].forEach(element => { element.disabled = capturing; });
  ["import-terms", "add-term", "builtin-terms"].forEach(id => { document.querySelector<HTMLButtonElement>(`#${id}`)!.disabled = capturing; });
  ["term-source", "term-target", "term-original", "term-translation", "term-domain"].forEach(id => { document.querySelector<HTMLInputElement>(`#${id}`)!.disabled = capturing; });
  muteOriginal.disabled = output.value === "subtitles";
  document.querySelector<HTMLButtonElement>("#save-preferences")!.disabled = capturing;
}

capture.disabled = output.disabled = reveal.disabled = true;
async function restore() {
  const settings = await chrome.storage.local.get(["sourceLanguage", "targetLanguage", "outputMode", ...preferenceKeys]);
  const { activeCapture, captureError } = await chrome.storage.session.get(["activeCapture", "captureError"]);
  source.value = settings.sourceLanguage ?? "auto";
  target.value = settings.targetLanguage ?? "fr";
  inputMode.value = settings.inputMode ?? "auto";
  domain.value = settings.domain ?? "general";
  glossary.value = settings.glossary ?? "";
  muteOriginal.checked = (activeCapture?.muteOriginal ?? settings.muteOriginal) !== false;
  recognitionQuality.value = settings.recognitionQuality ?? "balanced";
  translationEngine.value = settings.translationEngine ?? "classic";
  expert.value = settings.expert ?? "general";
  aiModel.value = settings.aiModel ?? "";
  expertPrompt.value = settings.expertPrompt ?? "";
  voiceEngine.value = settings.voiceEngine ?? "system";
  voiceRate.value = String(settings.voiceRate ?? 1);
  terminology.value = JSON.stringify(settings.terminology ?? {version: 1, entries: []}, null, 2);
  refreshTermCount();
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
  output.disabled = true;
  try {
    const response = await chrome.runtime.sendMessage({ type: "output.change", outputMode: output.value });
    if (!response?.ok) throw new Error(response?.error ?? "Choix non enregistré");
    state.textContent = capturing ? "Mode modifié — appliqué aux prochaines traductions" : "Mode de traduction enregistré";
  } catch (error) { state.textContent = String(error); }
  finally { output.disabled = false; updateButton(); }
});

muteOriginal.addEventListener("change", async () => {
  muteOriginal.disabled = true;
  try {
    const response = await chrome.runtime.sendMessage({type: "audio.change", muteOriginal: muteOriginal.checked});
    if (!response?.ok) throw new Error(response?.error ?? "Réglage audio non appliqué");
    showState(muteOriginal.checked ? "Voix originale coupée pendant la traduction vocale." : "Voix originale audible avec la traduction.");
  } catch (error) { muteOriginal.checked = !muteOriginal.checked; showState(String(error), true); }
  finally { updateButton(); }
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
      await chrome.storage.local.set({ sourceLanguage: source.value, targetLanguage: target.value, outputMode: outputMode(output.value), inputMode: inputMode.value, domain: domain.value, glossary: glossary.value.trim(), muteOriginal: muteOriginal.checked, recognitionQuality: recognitionQuality.value, ...advancedSettings() });
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
  try {
    await chrome.storage.local.set({inputMode: inputMode.value, domain: domain.value, glossary: glossary.value.trim(), recognitionQuality: recognitionQuality.value, ...advancedSettings()});
    showState("Réglages enregistrés pour la prochaine session.");
  } catch (error) { showState(String(error), true); }
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

function parsedTerms() {
  const value = JSON.parse(terminology.value || '{"version":1,"entries":[]}');
  if (value?.version !== 1 || !Array.isArray(value.entries) || value.entries.length > 500) throw new Error("Glossaire : version 1, entries, 500 termes maximum.");
  const seen = new Set<string>();
  for (const item of value.entries) {
    if (!item || ![item.source, item.target].every(code => typeof code === "string" && /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/.test(code)) ||
        ![item.term, item.translation].every(text => typeof text === "string" && text.trim() && text.length <= 200) ||
        typeof (item.domain ?? "*") !== "string" || !/^(?:\*|[a-z_]{1,40})$/.test(item.domain ?? "*")) throw new Error("Terme invalide : source, target, term, translation et domain facultatif.");
    const key = JSON.stringify([item.source, item.target, item.domain ?? "*", item.term.trim().toLowerCase()]);
    if (seen.has(key)) throw new Error("Terme en double pour ces langues et ce domaine.");
    seen.add(key);
  }
  return value;
}
function advancedSettings() {
  if (aiModel.value.trim().endsWith(":cloud")) throw new Error("Choisissez un modèle local, pas un modèle cloud.");
  return {translationEngine: translationEngine.value, expert: expert.value, aiModel: aiModel.value.trim(), expertPrompt: expertPrompt.value.trim(), voiceEngine: voiceEngine.value, voiceRate: Number(voiceRate.value), terminology: parsedTerms()};
}
const termsFile = document.querySelector<HTMLInputElement>("#terms-file")!;
document.querySelector<HTMLButtonElement>("#import-terms")!.onclick = () => termsFile.click();
termsFile.onchange = async () => {
  const file = termsFile.files?.[0]; if (!file) return;
  const old = terminology.value;
  try {
    if (file.size > 500000) throw new Error("Fichier trop volumineux.");
    terminology.value = await file.text();
    terminology.value = JSON.stringify(parsedTerms(), null, 2);
    refreshTermCount();
    showState("Glossaire importé. Enregistrez les réglages pour l’appliquer.");
  } catch (error) { terminology.value = old; showState(String(error), true); }
  termsFile.value = "";
};
document.querySelector<HTMLButtonElement>("#export-terms")!.onclick = () => {
  try {
    const url = URL.createObjectURL(new Blob([JSON.stringify(parsedTerms(), null, 2)], {type: "application/json"}));
    const link = document.createElement("a"); link.href = url; link.download = "polyglot-glossaire.json"; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (error) { showState(String(error), true); }
};

function refreshTermCount() {
  try { document.querySelector("#term-count")!.textContent = `${parsedTerms().entries.length} termes enregistrés dans l’éditeur. Cliquez sur Enregistrer les réglages.`; }
  catch { document.querySelector("#term-count")!.textContent = "Glossaire à vérifier."; }
}
terminology.addEventListener("input", refreshTermCount);
document.querySelector<HTMLButtonElement>("#add-term")!.onclick = () => {
  const input = (id: string) => document.querySelector<HTMLInputElement>(`#${id}`)!.value.trim();
  const old = terminology.value;
  try {
    const value = parsedTerms();
    const item = {source: input("term-source").toLowerCase(), target: input("term-target").toLowerCase(), term: input("term-original"), translation: input("term-translation"), domain: document.querySelector<HTMLInputElement>("#term-domain")!.checked ? domain.value : "*"};
    value.entries = value.entries.filter((entry: typeof item) => !(entry.source === item.source && entry.target === item.target && (entry.domain ?? "*") === item.domain && entry.term.toLowerCase() === item.term.toLowerCase()));
    value.entries.push(item); terminology.value = JSON.stringify(value, null, 2); parsedTerms(); refreshTermCount();
    showState("Terme ajouté. Enregistrez les réglages.");
  } catch (error) { terminology.value = old; showState(String(error), true); }
};
document.querySelector<HTMLButtonElement>("#builtin-terms")!.onclick = () => {
  try {
    const value = parsedTerms();
    for (const item of builtinTerms) {
      if (!value.entries.some((entry: typeof item) => entry.source === item.source && entry.target === item.target && (entry.domain ?? "*") === item.domain && entry.term.toLowerCase() === item.term.toLowerCase())) value.entries.push(item);
    }
    if (value.entries.length > 500) throw new Error("L’ajout dépasserait 500 termes.");
    terminology.value = JSON.stringify(value, null, 2); refreshTermCount(); showState("Termes IA ajoutés dans les 12 directions entre les quatre langues. Enregistrez les réglages.");
  } catch (error) { showState(String(error), true); }
};
