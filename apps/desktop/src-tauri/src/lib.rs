use rand::Rng;

#[tauri::command]
fn create_pairing_code() -> String {
    format!("{:06}", rand::thread_rng().gen_range(0..1_000_000))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![create_pairing_code])
        .run(tauri::generate_context!())
        .expect("échec du démarrage de Polyglot Live Translator");
}
