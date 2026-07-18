//! Pipeline d'intelligence artificielle : transcription audio, traduction et mode démo.
//! Les appels distants sont isolés ici afin de garder l'interface indépendante du fournisseur.
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::{Arc, Mutex};
use std::sync::atomic::{AtomicBool, Ordering};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GlossaryEntry {
    pub source: String,
    pub translation: String,
    pub domain: String,
}

#[derive(Clone)]
pub struct AiPipeline {
    client: reqwest::Client,
    glossary: Arc<Mutex<Vec<GlossaryEntry>>>,
    demo_mode: Arc<AtomicBool>,
}

impl Default for AiPipeline {
    fn default() -> Self {
        Self {
            client: reqwest::Client::new(),
            glossary: Arc::new(Mutex::new(vec![
                GlossaryEntry { source: "SIG".into(), translation: "SIG".into(), domain: "Géomatique".into() },
                GlossaryEntry { source: "QGIS".into(), translation: "QGIS".into(), domain: "Géomatique".into() },
                GlossaryEntry { source: "télédétection".into(), translation: "remote sensing".into(), domain: "Géomatique".into() },
            ])),
            demo_mode: Arc::new(AtomicBool::new(false)),
        }
    }
}

impl AiPipeline {
    pub fn set_demo_mode(&self, enabled: bool) { self.demo_mode.store(enabled, Ordering::SeqCst); }
    pub fn demo_mode(&self) -> bool { self.demo_mode.load(Ordering::SeqCst) }
    pub fn glossary(&self) -> Vec<GlossaryEntry> {
        self.glossary.lock().map(|items| items.clone()).unwrap_or_default()
    }

    pub fn upsert_glossary(&self, entry: GlossaryEntry) -> Result<(), String> {
        let mut items = self.glossary.lock().map_err(|_| "Glossaire indisponible")?;
        if let Some(existing) = items.iter_mut().find(|item| item.source.eq_ignore_ascii_case(&entry.source)) { *existing = entry; }
        else { items.push(entry); }
        Ok(())
    }

    pub async fn process_audio(&self, encoded: &str, mime_type: &str, source_language: &str, target_language: &str) -> Result<(String, String), String> {
        if self.demo_mode() {
            return Ok((
                "Bienvenue dans le mode démonstration de Polyglot Live Translator.".into(),
                format!("Traduction de démonstration vers {target_language} : le flux audio est correctement transmis."),
            ));
        }
        let key = std::env::var("OPENAI_API_KEY").or_else(|_| crate::security::get_api_key()).map_err(|_| "Clé API absente de l’application Windows")?;
        let bytes = STANDARD.decode(encoded).map_err(|_| "Segment audio Base64 invalide")?;
        let filename = if mime_type.contains("webm") { "segment.webm" } else { "segment.audio" };
        let part = reqwest::multipart::Part::bytes(bytes).file_name(filename).mime_str(mime_type).map_err(|error| format!("Format audio invalide : {error}"))?;
        let model = std::env::var("OPENAI_TRANSCRIPTION_MODEL").unwrap_or_else(|_| "gpt-4o-mini-transcribe".into());
        let mut form = reqwest::multipart::Form::new().part("file", part).text("model", model);
        if source_language != "auto" { form = form.text("language", source_language.to_string()); }
        let response = self.client.post("https://api.openai.com/v1/audio/transcriptions").bearer_auth(&key).multipart(form).send().await.map_err(|error| format!("Service de transcription inaccessible : {error}"))?;
        if !response.status().is_success() { return Err(format!("Transcription refusée : {}", response.text().await.unwrap_or_default())); }
        let original = response.json::<Value>().await.map_err(|error| format!("Réponse de transcription invalide : {error}"))?.get("text").and_then(Value::as_str).unwrap_or_default().trim().to_string();
        if original.is_empty() { return Err("Aucune parole reconnue dans ce segment".into()); }

        let glossary = self.glossary().into_iter().map(|item| format!("{} => {}", item.source, item.translation)).collect::<Vec<_>>().join("\n");
        let translation_model = std::env::var("OPENAI_TRANSLATION_MODEL").unwrap_or_else(|_| "gpt-5.6-sol".into());
        let body = json!({
            "model": translation_model,
            "input": [
                { "role": "system", "content": [{ "type": "input_text", "text": format!("Traduis fidèlement vers la langue {target_language}. Réponds uniquement par la traduction. Respecte prioritairement ce glossaire :\n{glossary}") }] },
                { "role": "user", "content": [{ "type": "input_text", "text": original }] }
            ]
        });
        let response = self.client.post("https://api.openai.com/v1/responses").bearer_auth(&key).json(&body).send().await.map_err(|error| format!("Service de traduction inaccessible : {error}"))?;
        if !response.status().is_success() { return Err(format!("Traduction refusée : {}", response.text().await.unwrap_or_default())); }
        let value = response.json::<Value>().await.map_err(|error| format!("Réponse de traduction invalide : {error}"))?;
        let translation = extract_output_text(&value).ok_or_else(|| "Traduction vide".to_string())?;
        Ok((original, translation))
    }

    pub async fn generate_study_aid(&self, transcript: &str, kind: &str) -> Result<String, String> {
        if self.demo_mode() { return Ok(format!("Mode démonstration — {kind}\n\n• Idée essentielle\n• Définition importante\n• Question de révision")); }
        let key = std::env::var("OPENAI_API_KEY").or_else(|_| crate::security::get_api_key()).map_err(|_| "Clé API absente de l’application Windows")?;
        let model = std::env::var("OPENAI_TRANSLATION_MODEL").unwrap_or_else(|_| "gpt-5.6-sol".into());
        let instruction = match kind {
            "quiz" => "Crée 10 questions à choix multiple avec réponses, sans inventer d'information.",
            "flashcards" => "Crée des cartes mémoire Question/Réponse fidèles au contenu.",
            "revision" => "Crée une fiche de révision structurée avec notions, définitions et exemples.",
            _ => "Rédige un résumé structuré, fidèle et concis, sans inventer d'information.",
        };
        let body = json!({ "model": model, "input": [{ "role": "system", "content": [{ "type": "input_text", "text": instruction }] }, { "role": "user", "content": [{ "type": "input_text", "text": transcript }] }] });
        let response = self.client.post("https://api.openai.com/v1/responses").bearer_auth(&key).json(&body).send().await.map_err(|error| format!("Génération impossible : {error}"))?;
        if !response.status().is_success() { return Err(format!("Génération refusée : {}", response.text().await.unwrap_or_default())); }
        let value = response.json::<Value>().await.map_err(|error| error.to_string())?;
        extract_output_text(&value).ok_or_else(|| "Résultat vide".into())
    }
}

fn extract_output_text(value: &Value) -> Option<String> {
    if let Some(text) = value.get("output_text").and_then(Value::as_str) { return Some(text.trim().into()); }
    value.get("output")?.as_array()?.iter().flat_map(|item| item.get("content").and_then(Value::as_array).into_iter().flatten()).find_map(|content| content.get("text").and_then(Value::as_str).map(|text| text.trim().to_string()))
}
