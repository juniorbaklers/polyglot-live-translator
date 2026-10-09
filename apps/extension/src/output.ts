export type OutputMode = "subtitles" | "voice" | "both";

export function outputMode(value: unknown): OutputMode {
  return value === "voice" || value === "both" ? value : "subtitles";
}

let voiceGeneration = 0;
let speechBusy = false;
let speechQueue: (() => void)[] = [];
let speechTimer: ReturnType<typeof setTimeout> | undefined;
let spokenIds = new Set<string>();
let warnedPiper = false;
let piperUnavailable = false;
export function stopSpeech() {
  voiceGeneration++; chrome.tts.stop(); clearTimeout(speechTimer);
  speechBusy = false; speechQueue = []; spokenIds.clear(); warnedPiper = false; piperUnavailable = false;
  chrome.runtime.sendMessage?.({type: "offscreen.voice.stop", target: "offscreen"}).catch(() => undefined);
}
export interface VoiceSettings { engine?: string; rate?: number; }

// La voix est jouée par l'extension, en dehors de l'onglet capturé.
export interface SubtitleUpdate { id?: string; revision?: number; final?: boolean; bounded?: boolean; start?: number; end?: number; timing?: string; origin?: string; uncertainWords?: string[]; sourceLanguage?: string; targetLanguage?: string; }
export function deliverTranslation(tabId: number, mode: OutputMode, language: string, original: string, translation: string, update?: SubtitleUpdate, allowSpeech = true, settings: VoiceSettings = {}) {
  const displayed = chrome.tabs.sendMessage(tabId, mode === "voice"
    ? { type: "overlay.hide", original, translation, ...update }
    : { type: "overlay.subtitle", original, translation, ...update }).catch(() => undefined);
  if (mode === "subtitles" || update?.final === false || !allowSpeech || !translation.trim()) return displayed;
  const reportError = (detail?: string) => {
    chrome.tabs.sendMessage(tabId, {
      type: "overlay.show",
      text: `Voix indisponible : ${detail ?? "vérifiez les voix installées sur votre ordinateur"}. Choisissez Sous-titres pour continuer.`
    }).catch(() => undefined);
  };
  const run = voiceGeneration;
  if (update?.id && spokenIds.has(update.id)) return displayed;
  if (speechQueue.length >= 5) {
    chrome.tabs.sendMessage(tabId, {type: "overlay.show", text: "La voix traduite prend du retard. Mettez la vidéo en pause pour laisser finir la lecture. Ce passage reste disponible dans l’historique."}).catch(() => undefined);
    return displayed;
  }
  if (update?.id) {
    spokenIds.add(update.id);
    if (spokenIds.size > 500) spokenIds.delete(spokenIds.values().next().value!);
  }
  const rate = Math.max(0.8, Math.min(1.4, settings.rate ?? 1));
  const task = () => {
    if (run !== voiceGeneration) return;
    speechBusy = true;
    let finished = false;
    const done = () => {
      if (finished || run !== voiceGeneration) return;
      finished = true; clearTimeout(speechTimer); speechBusy = false;
      speechQueue.shift()?.();
    };
    speechTimer = setTimeout(() => { if (run === voiceGeneration) { chrome.tts.stop(); reportError("lecture interrompue après un délai trop long"); done(); } }, 120000);
    const systemVoice = () => chrome.tts.getVoices((voices) => {
      if (finished || run !== voiceGeneration) return;
      const voice = voices.find((item) => !item.remote && !item.extensionId && item.lang?.split("-")[0] === language);
      if (!voice) { reportError("aucune voix locale installée pour cette langue"); done(); return; }
      chrome.tts.speak(translation, {
        lang: voice.lang, voiceName: voice.voiceName, enqueue: true, rate,
        onEvent: (event) => {
          if (event.type === "error" && run === voiceGeneration) reportError(event.errorMessage);
          if (["end", "error", "interrupted", "cancelled"].includes(event.type)) done();
        }
      }, () => { if (chrome.runtime.lastError) { reportError(chrome.runtime.lastError.message); done(); } });
    });
    if (!piperUnavailable && (settings.engine === "auto" || settings.engine === "piper")) {
      chrome.runtime.sendMessage({type: "offscreen.voice", target: "offscreen", text: translation, language, rate}).then(response => {
        if (finished || run !== voiceGeneration) return;
        if (response?.ok) { done(); return; }
        piperUnavailable = true;
        if (!warnedPiper) {
          warnedPiper = true;
          chrome.tabs.sendMessage(tabId, {type: "overlay.show", text: `Piper indisponible : ${response?.error ?? "vérifiez son installation"}. Utilisation de la voix locale du système.`}).catch(() => undefined);
        }
        systemVoice();
      }).catch(() => { if (!finished && run === voiceGeneration) { piperUnavailable = true; systemVoice(); } });
    } else systemVoice();
  };
  if (speechBusy) speechQueue.push(task); else task();
  return displayed;
}
