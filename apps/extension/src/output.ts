export type OutputMode = "subtitles" | "voice" | "both";

export function outputMode(value: unknown): OutputMode {
  return value === "voice" || value === "both" ? value : "subtitles";
}

let voiceGeneration = 0;
export function stopSpeech() { voiceGeneration++; chrome.tts.stop(); }

// La voix est jouée par l'extension, en dehors de l'onglet capturé.
export interface SubtitleUpdate { id?: string; revision?: number; final?: boolean; bounded?: boolean; start?: number; end?: number; timing?: string; origin?: string; uncertainWords?: string[]; sourceLanguage?: string; targetLanguage?: string; }
export function deliverTranslation(tabId: number, mode: OutputMode, language: string, original: string, translation: string, update?: SubtitleUpdate, allowSpeech = true) {
  const displayed = chrome.tabs.sendMessage(tabId, mode === "voice"
    ? { type: "overlay.hide" }
    : { type: "overlay.subtitle", original, translation, ...update }).catch(() => undefined);
  if (mode === "subtitles" || update?.final === false || !allowSpeech || !translation.trim()) return displayed;
  const reportError = (detail?: string) => {
    chrome.tabs.sendMessage(tabId, {
      type: "overlay.show",
      text: `Voix indisponible : ${detail ?? "vérifiez les voix installées sur votre ordinateur"}. Choisissez Sous-titres pour continuer.`
    }).catch(() => undefined);
  };
  const run = voiceGeneration;
  chrome.tts.getVoices((voices) => {
    if (run !== voiceGeneration) return;
    const voice = voices.find((item) => !item.remote && !item.extensionId && item.lang?.split("-")[0] === language);
    if (!voice) { reportError("aucune voix locale installée pour cette langue"); return; }
    chrome.tts.speak(translation, {
      lang: voice.lang,
      voiceName: voice.voiceName,
      enqueue: true,
      onEvent: (event) => { if (event.type === "error" && run === voiceGeneration) reportError(event.errorMessage); }
    }, () => {
      if (chrome.runtime.lastError) reportError(chrome.runtime.lastError.message);
    });
  });
  return displayed;
}
