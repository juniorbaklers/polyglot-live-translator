//! Implémentation Windows WASAPI pour le microphone et le son système en loopback.
use super::{update_meter, AudioDevice, AudioMeter, CaptureSource, POLL_INTERVAL};
use std::sync::{atomic::{AtomicBool, Ordering}, Arc, Mutex};
use std::time::Instant;
use windows::core::Interface;
use windows::Win32::Media::Audio::{
    eCapture, eConsole, eRender, IAudioCaptureClient, IAudioClient, IMMDevice,
    IMMDeviceEnumerator, MMDeviceEnumerator, AUDCLNT_SHAREMODE_SHARED,
    AUDCLNT_STREAMFLAGS_LOOPBACK,
};
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_ALL,
    COINIT_MULTITHREADED,
};

struct ComGuard;
impl Drop for ComGuard {
    fn drop(&mut self) { unsafe { CoUninitialize() } }
}

// Initialise COM pour le thread courant, prérequis des API audio Windows.
fn initialize_com() -> Result<ComGuard, String> {
    unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) }
        .ok()
        .map_err(|error| format!("Initialisation audio Windows impossible : {error}"))?;
    Ok(ComGuard)
}

fn enumerator() -> Result<IMMDeviceEnumerator, String> {
    unsafe { CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL) }
        .map_err(|error| format!("Service audio Windows indisponible : {error}"))
}

fn default_device(source: CaptureSource) -> Result<IMMDevice, String> {
    let enumerator = enumerator()?;
    let flow = match source {
        CaptureSource::Microphone => eCapture,
        CaptureSource::SystemAudio => eRender,
    };
    unsafe { enumerator.GetDefaultAudioEndpoint(flow, eConsole) }
        .map_err(|error| format!("Périphérique audio par défaut introuvable : {error}"))
}

pub fn default_devices() -> Result<Vec<AudioDevice>, String> {
    let _com = initialize_com()?;
    let _render = default_device(CaptureSource::SystemAudio)?;
    let _capture = default_device(CaptureSource::Microphone)?;
    Ok(vec![
        AudioDevice { id: "default-render".into(), label: "Haut-parleurs / écouteurs Windows par défaut".into(), kind: "output".into(), is_default: true },
        AudioDevice { id: "default-capture".into(), label: "Microphone Windows par défaut".into(), kind: "input".into(), is_default: true },
    ])
}

/// Capture le périphérique par défaut jusqu'à la réception du signal d'arrêt.
pub fn capture_default(
    source: CaptureSource,
    stop: &Arc<AtomicBool>,
    meter: &Arc<Mutex<AudioMeter>>,
    started: Instant,
) -> Result<(), String> {
    let _com = initialize_com()?;
    let device = default_device(source)?;
    let client: IAudioClient = unsafe { device.Activate(CLSCTX_ALL, None) }
        .map_err(|error| format!("Ouverture du périphérique impossible : {error}"))?;
    let format = unsafe { client.GetMixFormat() }
        .map_err(|error| format!("Format audio Windows non reconnu : {error}"))?;

    let flags = match source {
        CaptureSource::SystemAudio => AUDCLNT_STREAMFLAGS_LOOPBACK,
        CaptureSource::Microphone => Default::default(),
    };
    unsafe {
        client.Initialize(
            AUDCLNT_SHAREMODE_SHARED,
            flags,
            10_000_000,
            0,
            format,
            None,
        )
    }
    .map_err(|error| format!("Démarrage WASAPI impossible : {error}"))?;

    let capture: IAudioCaptureClient = unsafe { client.GetService() }
        .map_err(|error| format!("Service de capture inaccessible : {error}"))?;
    unsafe { client.Start() }
        .map_err(|error| format!("La capture audio n'a pas démarré : {error}"))?;

    while !stop.load(Ordering::SeqCst) {
        let packet_size = unsafe { capture.GetNextPacketSize() }
            .map_err(|error| format!("Lecture audio interrompue : {error}"))?;
        if packet_size == 0 {
            std::thread::sleep(POLL_INTERVAL);
            continue;
        }

        let mut data = std::ptr::null_mut();
        let mut frames = 0u32;
        let mut packet_flags = 0u32;
        unsafe { capture.GetBuffer(&mut data, &mut frames, &mut packet_flags, None, None) }
            .map_err(|error| format!("Bloc audio illisible : {error}"))?;

        let block_align = unsafe { (*format).nBlockAlign as usize };
        let bytes = frames as usize * block_align;
        let (rms, peak) = if data.is_null() || bytes == 0 || packet_flags & 0x2 != 0 {
            (0.0, 0.0)
        } else {
            calculate_level(unsafe { std::slice::from_raw_parts(data, bytes) }, unsafe { (*format).wBitsPerSample })
        };
        update_meter(meter, rms, peak, started);
        unsafe { capture.ReleaseBuffer(frames) }
            .map_err(|error| format!("Libération du bloc audio impossible : {error}"))?;
    }

    unsafe { client.Stop() }.ok();
    unsafe { windows::Win32::System::Com::CoTaskMemFree(Some(format.cast())) };
    Ok(())
}

// Convertit les échantillons PCM en niveau moyen et pic normalisés entre 0 et 1.
fn calculate_level(bytes: &[u8], bits_per_sample: u16) -> (f32, f32) {
    let samples: Vec<f32> = match bits_per_sample {
        16 => bytes.chunks_exact(2).map(|chunk| i16::from_le_bytes([chunk[0], chunk[1]]) as f32 / i16::MAX as f32).collect(),
        32 => bytes.chunks_exact(4).map(|chunk| f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]])).filter(|sample| sample.is_finite()).collect(),
        _ => Vec::new(),
    };
    if samples.is_empty() { return (0.0, 0.0); }
    let peak = samples.iter().fold(0.0f32, |value, sample| value.max(sample.abs()));
    let rms = (samples.iter().map(|sample| sample * sample).sum::<f32>() / samples.len() as f32).sqrt();
    (rms, peak)
}
