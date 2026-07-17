use serde::{Deserialize, Serialize};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

#[cfg(windows)]
mod windows_capture;

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum CaptureSource {
    Microphone,
    SystemAudio,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioDevice {
    pub id: String,
    pub label: String,
    pub kind: String,
    pub is_default: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioMeter {
    pub active: bool,
    pub level: f32,
    pub peak: f32,
    pub signal_detected: bool,
    pub elapsed_ms: u64,
    pub error: Option<String>,
}

impl Default for AudioMeter {
    fn default() -> Self {
        Self {
            active: false,
            level: 0.0,
            peak: 0.0,
            signal_detected: false,
            elapsed_ms: 0,
            error: None,
        }
    }
}

#[derive(Default)]
pub struct AudioEngine {
    meter: Arc<Mutex<AudioMeter>>,
    stop: Arc<AtomicBool>,
    worker: Mutex<Option<JoinHandle<()>>>,
}

impl AudioEngine {
    pub fn start(&self, source: CaptureSource) -> Result<(), String> {
        self.stop()?;
        self.stop.store(false, Ordering::SeqCst);
        *self.meter.lock().map_err(|_| "Jauge audio indisponible")? = AudioMeter {
            active: true,
            ..AudioMeter::default()
        };

        let stop = Arc::clone(&self.stop);
        let meter = Arc::clone(&self.meter);
        let worker = std::thread::spawn(move || {
            let started = Instant::now();
            #[cfg(windows)]
            let result = windows_capture::capture_default(source, &stop, &meter, started);

            #[cfg(not(windows))]
            let result: Result<(), String> = Err(
                "La capture WASAPI est disponible uniquement sous Windows 10 et 11.".into(),
            );

            if let Ok(mut current) = meter.lock() {
                current.active = false;
                current.elapsed_ms = started.elapsed().as_millis() as u64;
                if let Err(message) = result {
                    current.error = Some(message);
                }
            }
        });
        *self.worker.lock().map_err(|_| "Moteur audio indisponible")? = Some(worker);
        Ok(())
    }

    pub fn stop(&self) -> Result<(), String> {
        self.stop.store(true, Ordering::SeqCst);
        if let Some(worker) = self.worker.lock().map_err(|_| "Moteur audio indisponible")?.take() {
            worker.join().map_err(|_| "Arrêt anormal de la capture audio")?;
        }
        if let Ok(mut meter) = self.meter.lock() {
            meter.active = false;
        }
        Ok(())
    }

    pub fn meter(&self) -> AudioMeter {
        self.meter.lock().map(|value| value.clone()).unwrap_or_default()
    }
}

pub fn list_devices() -> Result<Vec<AudioDevice>, String> {
    #[cfg(windows)]
    return windows_capture::default_devices();

    #[cfg(not(windows))]
    Ok(vec![
        AudioDevice { id: "default-render".into(), label: "Sortie Windows par défaut".into(), kind: "output".into(), is_default: true },
        AudioDevice { id: "default-capture".into(), label: "Microphone Windows par défaut".into(), kind: "input".into(), is_default: true },
    ])
}

pub(crate) fn update_meter(
    meter: &Arc<Mutex<AudioMeter>>,
    level: f32,
    peak: f32,
    started: Instant,
) {
    if let Ok(mut current) = meter.lock() {
        current.active = true;
        current.level = level.clamp(0.0, 1.0);
        current.peak = current.peak.max(peak.clamp(0.0, 1.0));
        current.signal_detected |= peak > 0.01;
        current.elapsed_ms = started.elapsed().as_millis() as u64;
        current.error = None;
    }
}

pub(crate) const POLL_INTERVAL: Duration = Duration::from_millis(20);
