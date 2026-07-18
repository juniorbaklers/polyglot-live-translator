//! Stockage sécurisé de la clé API dans le gestionnaire d'identifiants du système.
const SERVICE: &str = "com.bakele.polyglotlive";
const ACCOUNT: &str = "openai-api-key";

fn entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(SERVICE, ACCOUNT).map_err(|error| format!("Coffre Windows indisponible : {error}"))
}

/// Enregistre une clé non vide sans l'écrire dans les fichiers du projet.
pub fn save_api_key(value: &str) -> Result<(), String> {
    if value.trim().is_empty() { return Err("La clé API est vide".into()); }
    entry()?.set_password(value.trim()).map_err(|error| format!("Enregistrement sécurisé impossible : {error}"))
}

pub fn get_api_key() -> Result<String, String> {
    entry()?.get_password().map_err(|_| "Aucune clé API enregistrée dans le coffre Windows".into())
}

pub fn delete_api_key() -> Result<(), String> {
    entry()?.delete_credential().map_err(|error| format!("Suppression de la clé impossible : {error}"))
}

pub fn has_api_key() -> bool { get_api_key().is_ok() || std::env::var("OPENAI_API_KEY").is_ok() }
