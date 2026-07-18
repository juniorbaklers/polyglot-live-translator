// Contrats partagés entre l'application Windows et l'extension navigateur.
// Ils garantissent que les deux parties utilisent les mêmes langues, états et messages.
export type LanguageCode =
  | "auto" | "fr" | "en" | "es" | "pt" | "de" | "it"
  | "ar" | "ru" | "zh" | "ja" | "ko" | "tr" | "el";

export type CaptureState =
  | "idle" | "permission-required" | "capturing" | "transcribing"
  | "translating" | "paused" | "no-audio" | "stopped" | "error";

// Préférences choisies par l'utilisateur au démarrage d'une traduction.
export interface SessionOptions {
  sourceLanguage: LanguageCode;
  targetLanguage: Exclude<LanguageCode, "auto">;
  showOriginal: boolean;
  speechOutput: boolean;
}

// Messages envoyés de l'extension vers le serveur local Windows.
export type ClientMessage =
  | { type: "pair.request"; code: string; extensionId: string }
  | { type: "session.start"; token: string; options: SessionOptions }
  | { type: "session.pause"; token: string }
  | { type: "session.stop"; token: string }
  | { type: "audio.chunk"; token: string; sequence: number; mimeType: string; data: string };

// Messages renvoyés par le serveur local vers l'extension.
export type ServerMessage =
  | { type: "pair.accepted"; token: string; expiresAt: string }
  | { type: "pair.rejected"; reason: string }
  | { type: "state"; state: CaptureState; detail?: string }
  | { type: "subtitle"; sequence: number; original: string; translation: string; final: boolean }
  | { type: "error"; code: string; message: string; action?: string };

// Port fixe du WebSocket accessible uniquement sur l'ordinateur de l'utilisateur.
export const LOCAL_WEBSOCKET_PORT = 47832;
