//! Les appels payants et les sorties simulées sont désactivés.
//! Les appels distants sont isolés ici afin de garder l'interface indépendante du fournisseur.
use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GlossaryEntry {
    pub source: String,
    pub translation: String,
    pub domain: String,
}

#[derive(Clone)]
pub struct AiPipeline {
    glossary: Arc<Mutex<Vec<GlossaryEntry>>>,
}

impl Default for AiPipeline {
    fn default() -> Self {
        Self {
            glossary: Arc::new(Mutex::new(vec![
                GlossaryEntry { source: "SIG".into(), translation: "SIG".into(), domain: "Géomatique".into() },
                GlossaryEntry { source: "QGIS".into(), translation: "QGIS".into(), domain: "Géomatique".into() },
                GlossaryEntry { source: "télédétection".into(), translation: "remote sensing".into(), domain: "Géomatique".into() },
            ])),
        }
    }
}

impl AiPipeline {
    pub fn set_demo_mode(&self, _enabled: bool) { /* Démonstration désactivée. */ }
    pub fn demo_mode(&self) -> bool { false }
    pub fn glossary(&self) -> Vec<GlossaryEntry> {
        self.glossary.lock().map(|items| items.clone()).unwrap_or_default()
    }

    pub fn upsert_glossary(&self, entry: GlossaryEntry) -> Result<(), String> {
        let mut items = self.glossary.lock().map_err(|_| "Glossaire indisponible")?;
        if let Some(existing) = items.iter_mut().find(|item| item.source.eq_ignore_ascii_case(&entry.source)) { *existing = entry; }
        else { items.push(entry); }
        Ok(())
    }

    pub async fn process_audio(&self, _encoded: &str, _mime_type: &str, _source_language: &str, _target_language: &str) -> Result<(String, String), String> {
        Err("Mode payant désactivé. Pour l’extension réelle, lancez le moteur local gratuit avec DEMARRER.cmd et utilisez son code d’association.".into())
    }

    pub async fn generate_study_aid(&self, _transcript: &str, _kind: &str) -> Result<String, String> {
        Err("Génération payante désactivée. Les résumés et quiz ne sont pas disponibles dans cette version locale de l’extension.".into())
    }
}
