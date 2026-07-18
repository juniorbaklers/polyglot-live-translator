// Contrôleur du popup : association avec Windows et démarrage de la capture d'onglet.
const state = document.querySelector<HTMLDivElement>("#state")!;
const capture = document.querySelector<HTMLButtonElement>("#capture")!;
const pair = document.querySelector<HTMLButtonElement>("#pair")!;
let capturing = false;

// Vérifie que le code contient exactement six chiffres avant de le mémoriser localement.
pair.addEventListener("click", async () => {
  const code = document.querySelector<HTMLInputElement>("#code")!.value.trim();
  if (!/^\d{6}$/.test(code)) { state.textContent = "Saisissez le code à 6 chiffres."; return; }
  await chrome.storage.local.set({ pairingCode: code });
  state.textContent = "Code enregistré — connexion locale en attente";
});

// Démarre ou arrête la capture de l'onglet actif et actualise l'interface.
capture.addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab.id) { state.textContent = "Onglet actif introuvable."; return; }
  capturing = !capturing;
  const sourceLanguage = document.querySelector<HTMLSelectElement>("#source")!.value;
  const targetLanguage = document.querySelector<HTMLSelectElement>("#target")!.value;
  await chrome.storage.local.set({ sourceLanguage, targetLanguage });
  const response = await chrome.runtime.sendMessage({ type: capturing ? "capture.start" : "capture.stop", tabId: tab.id });
  if (response && !response.ok) { capturing = false; state.textContent = response.error ?? "La capture n’a pas démarré"; return; }
  capture.textContent = capturing ? "Arrêter la capture" : "Capturer le son de cet onglet";
  capture.classList.toggle("stop", capturing);
  state.textContent = capturing ? "● Capture en cours" : "Capture interrompue";
});
