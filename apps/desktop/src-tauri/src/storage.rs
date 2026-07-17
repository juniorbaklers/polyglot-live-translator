use rusqlite::{params, Connection};
use serde::Serialize;
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};
use std::fs::File;
use std::io::BufWriter;
use docx_rs::{Docx, Paragraph, Run};
use printpdf::{BuiltinFont, Mm, PdfDocument};

#[derive(Clone)]
pub struct SessionStore {
    connection: Arc<Mutex<Connection>>,
    active_session: Arc<Mutex<Option<i64>>>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionSummary {
    pub id: i64,
    pub title: String,
    pub created_at: i64,
    pub source_language: String,
    pub target_language: String,
    pub segment_count: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptSegment {
    pub sequence: i64,
    pub timestamp_ms: i64,
    pub original: String,
    pub translation: String,
}

impl SessionStore {
    pub fn open(path: &Path) -> Result<Self, String> {
        if let Some(parent) = path.parent() { std::fs::create_dir_all(parent).map_err(|error| error.to_string())?; }
        let connection = Connection::open(path).map_err(|error| format!("Ouverture SQLite impossible : {error}"))?;
        connection.execute_batch(
            "PRAGMA journal_mode=WAL;
             CREATE TABLE IF NOT EXISTS sessions(id INTEGER PRIMARY KEY, title TEXT NOT NULL, created_at INTEGER NOT NULL, source_language TEXT NOT NULL, target_language TEXT NOT NULL);
             CREATE TABLE IF NOT EXISTS segments(id INTEGER PRIMARY KEY, session_id INTEGER NOT NULL, sequence INTEGER NOT NULL, timestamp_ms INTEGER NOT NULL, original TEXT NOT NULL, translation TEXT NOT NULL, FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE);
             CREATE INDEX IF NOT EXISTS idx_segments_session ON segments(session_id, sequence);"
        ).map_err(|error| format!("Initialisation SQLite impossible : {error}"))?;
        Ok(Self { connection: Arc::new(Mutex::new(connection)), active_session: Arc::new(Mutex::new(None)) })
    }

    pub fn start(&self, source: &str, target: &str) -> Result<i64, String> {
        let created_at = now_ms();
        let title = format!("Traduction du {}", created_at);
        let connection = self.connection.lock().map_err(|_| "Base SQLite indisponible")?;
        connection.execute("INSERT INTO sessions(title, created_at, source_language, target_language) VALUES(?1,?2,?3,?4)", params![title, created_at, source, target]).map_err(|error| error.to_string())?;
        let id = connection.last_insert_rowid();
        *self.active_session.lock().map_err(|_| "Session indisponible")? = Some(id);
        Ok(id)
    }

    pub fn add_segment(&self, sequence: i64, original: &str, translation: &str, source: &str, target: &str) -> Result<(), String> {
        let current = { *self.active_session.lock().map_err(|_| "Session indisponible")? };
        let session_id = match current { Some(id) => id, None => self.start(source, target)? };
        self.connection.lock().map_err(|_| "Base SQLite indisponible")?.execute(
            "INSERT INTO segments(session_id, sequence, timestamp_ms, original, translation) VALUES(?1,?2,?3,?4,?5)",
            params![session_id, sequence, now_ms(), original, translation],
        ).map_err(|error| error.to_string())?;
        Ok(())
    }

    pub fn stop(&self) { if let Ok(mut active) = self.active_session.lock() { *active = None; } }

    pub fn sessions(&self) -> Result<Vec<SessionSummary>, String> {
        let connection = self.connection.lock().map_err(|_| "Base SQLite indisponible")?;
        let mut statement = connection.prepare("SELECT s.id,s.title,s.created_at,s.source_language,s.target_language,COUNT(g.id) FROM sessions s LEFT JOIN segments g ON g.session_id=s.id GROUP BY s.id ORDER BY s.created_at DESC").map_err(|error| error.to_string())?;
        statement.query_map([], |row| Ok(SessionSummary { id: row.get(0)?, title: row.get(1)?, created_at: row.get(2)?, source_language: row.get(3)?, target_language: row.get(4)?, segment_count: row.get(5)? })).map_err(|error| error.to_string())?.collect::<Result<Vec<_>, _>>().map_err(|error| error.to_string())
    }

    pub fn segments(&self, session_id: i64) -> Result<Vec<TranscriptSegment>, String> {
        let connection = self.connection.lock().map_err(|_| "Base SQLite indisponible")?;
        let mut statement = connection.prepare("SELECT sequence,timestamp_ms,original,translation FROM segments WHERE session_id=?1 ORDER BY sequence").map_err(|error| error.to_string())?;
        statement.query_map([session_id], |row| Ok(TranscriptSegment { sequence: row.get(0)?, timestamp_ms: row.get(1)?, original: row.get(2)?, translation: row.get(3)? })).map_err(|error| error.to_string())?.collect::<Result<Vec<_>, _>>().map_err(|error| error.to_string())
    }

    pub fn export(&self, session_id: i64, format: &str, path: &Path) -> Result<(), String> {
        let segments = self.segments(session_id)?;
        let normalized = format.to_ascii_lowercase();
        if normalized == "docx" { return export_docx(path, &segments); }
        if normalized == "pdf" { return export_pdf(path, &segments); }
        let output = match normalized.as_str() {
            "txt" => segments.iter().map(|item| format!("{}\n{}", item.original, item.translation)).collect::<Vec<_>>().join("\n\n"),
            "srt" => segments.iter().enumerate().map(|(index,item)| format!("{}\n{} --> {}\n{}\n{}", index+1, srt_time(index as u64*4), srt_time(index as u64*4+4), item.original, item.translation)).collect::<Vec<_>>().join("\n\n"),
            "vtt" => format!("WEBVTT\n\n{}", segments.iter().enumerate().map(|(index,item)| format!("{} --> {}\n{}\n{}", vtt_time(index as u64*4), vtt_time(index as u64*4+4), item.original, item.translation)).collect::<Vec<_>>().join("\n\n")),
            "csv" => format!("sequence;original;translation\n{}", segments.iter().map(|item| format!("{};\"{}\";\"{}\"", item.sequence, item.original.replace('"', "\"\""), item.translation.replace('"', "\"\""))).collect::<Vec<_>>().join("\n")),
            "json" => serde_json::to_string_pretty(&segments).map_err(|error| error.to_string())?,
            _ => return Err("Format disponible : TXT, SRT, VTT, CSV, JSON, DOCX ou PDF".into()),
        };
        std::fs::write(path, output).map_err(|error| format!("Export impossible : {error}"))
    }
}

fn now_ms() -> i64 { SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() as i64 }
fn srt_time(seconds: u64) -> String { format!("{:02}:{:02}:{:02},000", seconds/3600, (seconds%3600)/60, seconds%60) }
fn vtt_time(seconds: u64) -> String { format!("{:02}:{:02}:{:02}.000", seconds/3600, (seconds%3600)/60, seconds%60) }

fn export_docx(path: &Path, segments: &[TranscriptSegment]) -> Result<(), String> {
    let mut document = Docx::new().add_paragraph(Paragraph::new().add_run(Run::new().add_text("Polyglot Live Translator — Transcription")));
    for item in segments {
        document = document
            .add_paragraph(Paragraph::new().add_run(Run::new().add_text(&item.original).bold()))
            .add_paragraph(Paragraph::new().add_run(Run::new().add_text(&item.translation)));
    }
    let file = File::create(path).map_err(|error| error.to_string())?;
    document.build().pack(file).map_err(|error| format!("Export DOCX impossible : {error}"))
}

fn export_pdf(path: &Path, segments: &[TranscriptSegment]) -> Result<(), String> {
    let (document, page, layer) = PdfDocument::new("Polyglot Live Translator", Mm(210.0), Mm(297.0), "Transcription");
    let layer = document.get_page(page).get_layer(layer);
    let font = document.add_builtin_font(BuiltinFont::Helvetica).map_err(|error| error.to_string())?;
    let text = segments.iter().map(|item| format!("{}\n{}", item.original, item.translation)).collect::<Vec<_>>().join("\n\n");
    layer.use_text(text, 10.0, Mm(18.0), Mm(278.0), &font);
    document.save(&mut BufWriter::new(File::create(path).map_err(|error| error.to_string())?)).map_err(|error| format!("Export PDF impossible : {error}"))
}
