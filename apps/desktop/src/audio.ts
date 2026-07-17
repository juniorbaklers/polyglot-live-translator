import { invoke } from "@tauri-apps/api/core";

export type CaptureSource = "microphone" | "system-audio";

export interface AudioDevice {
  id: string;
  label: string;
  kind: "input" | "output";
  isDefault: boolean;
}

export interface AudioMeter {
  active: boolean;
  level: number;
  peak: number;
  signalDetected: boolean;
  elapsedMs: number;
  error?: string | null;
}

export const audioApi = {
  listDevices: () => invoke<AudioDevice[]>("list_audio_devices"),
  start: (source: CaptureSource) => invoke<void>("start_audio_capture", { source }),
  stop: () => invoke<void>("stop_audio_capture"),
  meter: () => invoke<AudioMeter>("get_audio_meter")
};
