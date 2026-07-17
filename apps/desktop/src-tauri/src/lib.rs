use rand::Rng;
use tauri::Manager;
use tauri::{WebviewUrl, WebviewWindowBuilder};
mod audio;
mod ai;
mod local_api;
mod security;
mod storage;

use audio::{AudioDevice, AudioEngine, AudioMeter, CaptureSource};
use local_api::{BrowserCaptureStatus, PairingState};
use ai::{AiPipeline, GlossaryEntry};
use storage::{SessionStore, SessionSummary, TranscriptSegment};
use std::path::PathBuf;

#[tauri::command]
fn create_pairing_code() -> String {
    format!("{:06}", rand::thread_rng().gen_range(0..1_000_000))
}

#[tauri::command]
fn get_pairing_code(pairing: tauri::State<'_, PairingState>) -> String { pairing.code() }

#[tauri::command]
fn get_browser_capture_status(pairing: tauri::State<'_, PairingState>) -> BrowserCaptureStatus { pairing.status() }

#[tauri::command]
fn list_glossary(pipeline: tauri::State<'_, AiPipeline>) -> Vec<GlossaryEntry> { pipeline.glossary() }

#[tauri::command]
fn upsert_glossary(entry: GlossaryEntry, pipeline: tauri::State<'_, AiPipeline>) -> Result<(), String> { pipeline.upsert_glossary(entry) }

#[tauri::command]
fn set_demo_mode(enabled: bool, pipeline: tauri::State<'_, AiPipeline>) { pipeline.set_demo_mode(enabled); }

#[tauri::command]
fn get_demo_mode(pipeline: tauri::State<'_, AiPipeline>) -> bool { pipeline.demo_mode() }

#[tauri::command]
fn open_subtitle_window(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("subtitles") { window.show().map_err(|error| error.to_string())?; return Ok(()); }
    WebviewWindowBuilder::new(&app, "subtitles", WebviewUrl::App("subtitle.html".into()))
        .title("Sous-titres Polyglot Live")
        .inner_size(900.0, 190.0)
        .min_inner_size(420.0, 120.0)
        .always_on_top(true)
        .decorations(false)
        .transparent(true)
        .resizable(true)
        .build()
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
fn save_api_key(value: String) -> Result<(), String> { security::save_api_key(&value) }

#[tauri::command]
fn delete_api_key() -> Result<(), String> { security::delete_api_key() }

#[tauri::command]
fn has_api_key() -> bool { security::has_api_key() }

#[tauri::command]
fn list_sessions(store: tauri::State<'_, SessionStore>) -> Result<Vec<SessionSummary>, String> { store.sessions() }

#[tauri::command]
fn get_session_segments(session_id: i64, store: tauri::State<'_, SessionStore>) -> Result<Vec<TranscriptSegment>, String> { store.segments(session_id) }

#[tauri::command]
fn export_session(session_id: i64, format: String, output_path: String, store: tauri::State<'_, SessionStore>) -> Result<(), String> { store.export(session_id, &format, &PathBuf::from(output_path)) }

#[tauri::command]
async fn generate_study_aid(session_id: i64, kind: String, store: tauri::State<'_, SessionStore>, pipeline: tauri::State<'_, AiPipeline>) -> Result<String, String> {
    let transcript = store.segments(session_id)?.into_iter().map(|item| item.original).collect::<Vec<_>>().join("\n");
    if transcript.is_empty() { return Err("Cette session ne contient aucune transcription".into()); }
    pipeline.generate_study_aid(&transcript, &kind).await
}

#[tauri::command]
async fn process_imported_media(data: String, mime_type: String, source_language: String, target_language: String, pipeline: tauri::State<'_, AiPipeline>) -> Result<serde_json::Value, String> {
    let (original, translation) = pipeline.process_audio(&data, &mime_type, &source_language, &target_language).await?;
    Ok(serde_json::json!({ "original": original, "translation": translation }))
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
        .manage(AiPipeline::default())
        .manage(PairingState::default())
        .setup(|app| {
            let pipeline = app.state::<AiPipeline>().inner().clone();
            let database_path = app.path().app_data_dir().map_err(|error| error.to_string())?.join("polyglot-live.db");
            let store = SessionStore::open(&database_path).map_err(std::io::Error::other)?;
            app.manage(store.clone());
            let pairing = app.state::<PairingState>().inner().clone().with_pipeline(pipeline).with_store(store);
            tauri::async_runtime::spawn(local_api::run(pairing));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            create_pairing_code,
            get_pairing_code,
            get_browser_capture_status,
            list_glossary,
            upsert_glossary,
            set_demo_mode,
            get_demo_mode,
            open_subtitle_window,
            save_api_key,
            delete_api_key,
            has_api_key,
            list_sessions,
            get_session_segments,
            export_session,
            generate_study_aid,
            process_imported_media,
            list_audio_devices,
            start_audio_capture,
            stop_audio_capture,
            get_audio_meter
        ])
        .run(tauri::generate_context!())
        .expect("échec du démarrage de Polyglot Live Translator");
}
