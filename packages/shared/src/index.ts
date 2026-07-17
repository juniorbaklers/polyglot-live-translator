export type LanguageCode =
  | "auto" | "fr" | "en" | "es" | "pt" | "de" | "it"
  | "ar" | "ru" | "zh" | "ja" | "ko" | "tr" | "el";

export type CaptureState =
  | "idle" | "permission-required" | "capturing" | "transcribing"
  | "translating" | "paused" | "no-audio" | "stopped" | "error";

export interface SessionOptions {
  sourceLanguage: LanguageCode;
  targetLanguage: Exclude<LanguageCode, "auto">;
  showOriginal: boolean;
  speechOutput: boolean;
}

export type ClientMessage =
  | { type: "pair.request"; code: string; extensionId: string }
  | { type: "session.start"; token: string; options: SessionOptions }
  | { type: "session.pause"; token: string }
  | { type: "session.stop"; token: string }
  | { type: "audio.chunk"; token: string; sequence: number; mimeType: string; data: string };

export type ServerMessage =
  | { type: "pair.accepted"; token: string; expiresAt: string }
  | { type: "pair.rejected"; reason: string }
  | { type: "state"; state: CaptureState; detail?: string }
  | { type: "subtitle"; sequence: number; original: string; translation: string; final: boolean }
  | { type: "error"; code: string; message: string; action?: string };
