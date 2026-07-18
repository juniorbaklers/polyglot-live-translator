//! Serveur WebSocket local reliant l'extension navigateur à l'application Windows.
//! L'association par code et jeton empêche un client non autorisé d'envoyer de l'audio.
use futures_util::{SinkExt, StreamExt};
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::HashSet;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::net::{TcpListener, TcpStream};
use tokio_tungstenite::{accept_async, tungstenite::Message, WebSocketStream};
use uuid::Uuid;
use crate::ai::AiPipeline;
use crate::storage::SessionStore;

pub const LOCAL_WS_ADDRESS: &str = "127.0.0.1:47832";

#[derive(Clone)]
pub struct PairingState {
    code: Arc<Mutex<String>>,
    tokens: Arc<Mutex<HashSet<String>>>,
    status: Arc<Mutex<BrowserCaptureStatus>>,
    pipeline: Option<AiPipeline>,
    store: Option<SessionStore>,
}

impl Default for PairingState {
    fn default() -> Self {
        Self {
            code: Arc::new(Mutex::new(format!("{:06}", rand::random::<u32>() % 1_000_000))),
            tokens: Arc::new(Mutex::new(HashSet::new())),
            status: Arc::new(Mutex::new(BrowserCaptureStatus::default())),
            pipeline: None,
            store: None,
        }
    }
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserCaptureStatus {
    pub connected: bool,
    pub capturing: bool,
    pub extension_id: Option<String>,
    pub chunks_received: u64,
    pub bytes_received: u64,
    pub last_chunk_at: Option<u64>,
    pub error: Option<String>,
    pub source_language: String,
    pub target_language: String,
    pub latest_original: String,
    pub latest_translation: String,
}

impl PairingState {
    pub fn with_pipeline(mut self, pipeline: AiPipeline) -> Self { self.pipeline = Some(pipeline); self }
    pub fn with_store(mut self, store: SessionStore) -> Self { self.store = Some(store); self }
    pub fn code(&self) -> String {
        self.code.lock().map(|value| value.clone()).unwrap_or_default()
    }
    pub fn status(&self) -> BrowserCaptureStatus {
        self.status.lock().map(|value| value.clone()).unwrap_or_default()
    }
}

/// Écoute uniquement l'adresse locale afin de ne jamais exposer le service sur Internet.
pub async fn run(state: PairingState) {
    let listener = match TcpListener::bind(LOCAL_WS_ADDRESS).await {
        Ok(listener) => listener,
        Err(error) => {
            if let Ok(mut status) = state.status.lock() { status.error = Some(format!("API locale indisponible : {error}")); }
            return;
        }
    };
    while let Ok((stream, _)) = listener.accept().await {
        let state = state.clone();
        tokio::spawn(async move {
            if let Err(error) = handle_connection(stream, state.clone()).await {
                if let Ok(mut status) = state.status.lock() {
                    status.connected = false;
                    status.capturing = false;
                    status.error = Some(error);
                }
            }
        });
    }
}

// Traite une connexion, vérifie son association puis distribue ses messages JSON.
async fn handle_connection(stream: TcpStream, state: PairingState) -> Result<(), String> {
    let mut socket = accept_async(stream).await.map_err(|error| format!("Connexion WebSocket refusée : {error}"))?;
    while let Some(message) = socket.next().await {
        let message = message.map_err(|error| format!("Message local illisible : {error}"))?;
        if !message.is_text() { continue; }
        let value: Value = serde_json::from_str(message.to_text().unwrap_or_default()).map_err(|error| format!("Message JSON invalide : {error}"))?;
        match value.get("type").and_then(Value::as_str).unwrap_or_default() {
            "pair.request" => {
                let code = value.get("code").and_then(Value::as_str).unwrap_or_default();
                let extension_id = value.get("extensionId").and_then(Value::as_str).unwrap_or_default();
                if code != state.code() || extension_id.is_empty() {
                    send_json(&mut socket, json!({ "type": "pair.rejected", "reason": "Code d’association incorrect ou expiré" })).await?;
                    continue;
                }
                let token = Uuid::new_v4().to_string();
                state.tokens.lock().map_err(|_| "Coffre de jetons indisponible")?.insert(token.clone());
                if let Ok(mut status) = state.status.lock() { status.connected = true; status.extension_id = Some(extension_id.into()); status.error = None; }
                send_json(&mut socket, json!({ "type": "pair.accepted", "token": token, "expiresAt": "fermeture-application" })).await?;
            }
            "session.start" => {
                validate_token(&state, &value)?;
                if let Ok(mut status) = state.status.lock() {
                    status.capturing = true;
                    status.source_language = value.pointer("/options/sourceLanguage").and_then(Value::as_str).unwrap_or("auto").into();
                    status.target_language = value.pointer("/options/targetLanguage").and_then(Value::as_str).unwrap_or("fr").into();
                }
                send_json(&mut socket, json!({ "type": "state", "state": "capturing", "detail": "Audio de l’onglet reçu" })).await?;
            }
            "audio.chunk" => {
                validate_token(&state, &value)?;
                let size = value.get("data").and_then(Value::as_str).map(|data| data.len() as u64).unwrap_or(0);
                if let Ok(mut status) = state.status.lock() {
                    status.capturing = true;
                    status.chunks_received += 1;
                    status.bytes_received += size;
                    status.last_chunk_at = Some(now_seconds());
                }
                let encoded = value.get("data").and_then(Value::as_str).unwrap_or_default();
                let mime_type = value.get("mimeType").and_then(Value::as_str).unwrap_or("audio/webm");
                let (source_language, target_language) = state.status.lock().map(|status| (status.source_language.clone(), status.target_language.clone())).unwrap_or_else(|_| ("auto".into(), "fr".into()));
                if let Some(pipeline) = &state.pipeline {
                    match pipeline.process_audio(encoded, mime_type, &source_language, &target_language).await {
                        Ok((original, translation)) => {
                            if let Ok(mut status) = state.status.lock() { status.latest_original = original.clone(); status.latest_translation = translation.clone(); status.error = None; }
                            if let Some(store) = &state.store { let _ = store.add_segment(value.get("sequence").and_then(Value::as_i64).unwrap_or(0), &original, &translation, &source_language, &target_language); }
                            send_json(&mut socket, json!({ "type": "subtitle", "sequence": value.get("sequence").and_then(Value::as_u64).unwrap_or(0), "original": original, "translation": translation, "final": true })).await?;
                        }
                        Err(error) => {
                            if let Ok(mut status) = state.status.lock() { status.error = Some(error.clone()); }
                            send_json(&mut socket, json!({ "type": "error", "code": "AI_PIPELINE", "message": error })).await?;
                        }
                    }
                }
            }
            "session.stop" => {
                validate_token(&state, &value)?;
                if let Ok(mut status) = state.status.lock() { status.capturing = false; }
                if let Some(store) = &state.store { store.stop(); }
                send_json(&mut socket, json!({ "type": "state", "state": "stopped" })).await?;
            }
            _ => send_json(&mut socket, json!({ "type": "error", "code": "UNKNOWN_MESSAGE", "message": "Message local non reconnu" })).await?,
        }
    }
    if let Ok(mut status) = state.status.lock() { status.connected = false; status.capturing = false; }
    Ok(())
}

fn validate_token(state: &PairingState, value: &Value) -> Result<(), String> {
    let token = value.get("token").and_then(Value::as_str).unwrap_or_default();
    if state.tokens.lock().map_err(|_| "Coffre de jetons indisponible")?.contains(token) { Ok(()) } else { Err("Jeton local absent ou expiré".into()) }
}

async fn send_json(socket: &mut WebSocketStream<TcpStream>, value: Value) -> Result<(), String> {
    socket.send(Message::Text(value.to_string())).await.map_err(|error| format!("Réponse locale impossible : {error}"))
}

fn now_seconds() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs()
}
