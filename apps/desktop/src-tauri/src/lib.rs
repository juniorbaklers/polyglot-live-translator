use rand::Rng;
mod audio;

use audio::{AudioDevice, AudioEngine, AudioMeter, CaptureSource};

#[tauri::command]
fn create_pairing_code() -> String {
    format!("{:06}", rand::thread_rng().gen_range(0..1_000_000))
}

#[tauri::command]
fn list_audio_devices() -> Result<Vec<AudioDevice>, String> {
    audio::list_devices()
}

#[tauri::command]
fn start_audio_capture(
    source: CaptureSource,
    engine: tauri::State<'_, AudioEngine>,
) -> Result<(), String> {
    engine.start(source)
}

#[tauri::command]
fn stop_audio_capture(engine: tauri::State<'_, AudioEngine>) -> Result<(), String> {
    engine.stop()
}

#[tauri::command]
fn get_audio_meter(engine: tauri::State<'_, AudioEngine>) -> AudioMeter {
    engine.meter()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AudioEngine::default())
        .invoke_handler(tauri::generate_handler![
            create_pairing_code,
            list_audio_devices,
            start_audio_capture,
            stop_audio_capture,
            get_audio_meter
        ])
        .run(tauri::generate_context!())
        .expect("échec du démarrage de Polyglot Live Translator");
}
