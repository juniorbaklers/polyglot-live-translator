//! Moteur audio : capture WASAPI, jauge et constitution de segments WAV.
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
        Self { active: false, level: 0.0, peak: 0.0, signal_detected: false, elapsed_ms: 0, error: None }
    }
}

#[derive(Default)]
pub(crate) struct AudioBuffer {
    sample_rate: u32,
    channels: u16,
    samples: Vec<i16>,
}

impl AudioBuffer {
    pub(crate) fn configure(&mut self, sample_rate: u32, channels: u16) {
        if self.sample_rate != sample_rate || self.channels != channels {
            self.samples.clear();
        }
        self.sample_rate = sample_rate;
        self.channels = channels;
    }

    pub(crate) fn extend(&mut self, samples: impl IntoIterator<Item = i16>) {
        self.samples.extend(samples);
    }

    fn take_wav(&mut self) -> Option<Vec<u8>> {
        let channels = self.channels.max(1);
        let sample_rate = self.sample_rate;
        // Attendre au moins une seconde pour éviter les requêtes audio vides.
        if sample_rate == 0 || self.samples.len() < sample_rate as usize * channels as usize {
            return None;
        }
        let samples = std::mem::take(&mut self.samples);
        Some(encode_pcm16_wav(&samples, sample_rate, channels))
    }
}

#[derive(Default)]
pub struct AudioEngine {
    meter: Arc<Mutex<AudioMeter>>,
    buffer: Arc<Mutex<AudioBuffer>>,
    stop: Arc<AtomicBool>,
    worker: Mutex<Option<JoinHandle<()>>>,
}

impl AudioEngine {
    pub fn start(&self, source: CaptureSource) -> Result<(), String> {
        self.stop()?;
        self.stop.store(false, Ordering::SeqCst);
        *self.meter.lock().map_err(|_| "Jauge audio indisponible")? = AudioMeter { active: true, ..AudioMeter::default() };
        *self.buffer.lock().map_err(|_| "Tampon audio indisponible")? = AudioBuffer::default();

        let stop = Arc::clone(&self.stop);
        let meter = Arc::clone(&self.meter);
        let buffer = Arc::clone(&self.buffer);
        let worker = std::thread::spawn(move || {
            let started = Instant::now();
            #[cfg(windows)]
            let result = windows_capture::capture_default(source, &stop, &meter, &buffer, started);
            #[cfg(not(windows))]
            let result: Result<(), String> = Err("La capture WASAPI est disponible uniquement sous Windows 10 et 11.".into());

            if let Ok(mut current) = meter.lock() {
                current.active = false;
                current.elapsed_ms = started.elapsed().as_millis() as u64;
                if let Err(message) = result { current.error = Some(message); }
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
        if let Ok(mut meter) = self.meter.lock() { meter.active = false; }
        Ok(())
    }

    pub fn meter(&self) -> AudioMeter {
        self.meter.lock().map(|value| value.clone()).unwrap_or_default()
    }

    pub fn take_wav_segment(&self) -> Result<Option<Vec<u8>>, String> {
        Ok(self.buffer.lock().map_err(|_| "Tampon audio indisponible")?.take_wav())
    }
}

fn encode_pcm16_wav(samples: &[i16], sample_rate: u32, channels: u16) -> Vec<u8> {
    let data_len = (samples.len() * 2) as u32;
    let byte_rate = sample_rate * channels as u32 * 2;
    let block_align = channels * 2;
    let mut wav = Vec::with_capacity(44 + data_len as usize);
    wav.extend_from_slice(b"RIFF");
    wav.extend_from_slice(&(36 + data_len).to_le_bytes());
    wav.extend_from_slice(b"WAVEfmt ");
    wav.extend_from_slice(&16u32.to_le_bytes());
    wav.extend_from_slice(&1u16.to_le_bytes());
    wav.extend_from_slice(&channels.to_le_bytes());
    wav.extend_from_slice(&sample_rate.to_le_bytes());
    wav.extend_from_slice(&byte_rate.to_le_bytes());
    wav.extend_from_slice(&block_align.to_le_bytes());
    wav.extend_from_slice(&16u16.to_le_bytes());
    wav.extend_from_slice(b"data");
    wav.extend_from_slice(&data_len.to_le_bytes());
    for sample in samples { wav.extend_from_slice(&sample.to_le_bytes()); }
    wav
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

pub(crate) fn update_meter(meter: &Arc<Mutex<AudioMeter>>, level: f32, peak: f32, started: Instant) {
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
