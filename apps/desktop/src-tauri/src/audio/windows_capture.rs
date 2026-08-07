//! Capture Windows WASAPI : mesure et copie des échantillons réellement transcrits.
use super::{update_meter, AudioBuffer, AudioDevice, AudioMeter, CaptureSource, POLL_INTERVAL};
use std::sync::{atomic::{AtomicBool, Ordering}, Arc, Mutex};
use std::time::Instant;
use windows::Win32::Media::Audio::{
    eCapture, eConsole, eRender, IAudioCaptureClient, IAudioClient, IMMDevice,
    IMMDeviceEnumerator, MMDeviceEnumerator, AUDCLNT_SHAREMODE_SHARED,
    AUDCLNT_STREAMFLAGS_LOOPBACK,
};
use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_ALL, COINIT_MULTITHREADED};

struct ComGuard;
impl Drop for ComGuard { fn drop(&mut self) { unsafe { CoUninitialize() } } }

fn initialize_com() -> Result<ComGuard, String> {
    unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) }.ok()
        .map_err(|error| format!("Initialisation audio Windows impossible : {error}"))?;
    Ok(ComGuard)
}

fn enumerator() -> Result<IMMDeviceEnumerator, String> {
    unsafe { CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL) }
        .map_err(|error| format!("Service audio Windows indisponible : {error}"))
}

fn default_device(source: CaptureSource) -> Result<IMMDevice, String> {
    let flow = match source { CaptureSource::Microphone => eCapture, CaptureSource::SystemAudio => eRender };
    unsafe { enumerator()?.GetDefaultAudioEndpoint(flow, eConsole) }
        .map_err(|error| format!("Périphérique audio par défaut introuvable : {error}"))
}

pub fn default_devices() -> Result<Vec<AudioDevice>, String> {
    let _com = initialize_com()?;
    let _ = default_device(CaptureSource::SystemAudio)?;
    let _ = default_device(CaptureSource::Microphone)?;
    Ok(vec![
        AudioDevice { id: "default-render".into(), label: "Haut-parleurs / écouteurs Windows par défaut".into(), kind: "output".into(), is_default: true },
        AudioDevice { id: "default-capture".into(), label: "Microphone Windows par défaut".into(), kind: "input".into(), is_default: true },
    ])
}

pub fn capture_default(
    source: CaptureSource,
    stop: &Arc<AtomicBool>,
    meter: &Arc<Mutex<AudioMeter>>,
    buffer: &Arc<Mutex<AudioBuffer>>,
    started: Instant,
) -> Result<(), String> {
    let _com = initialize_com()?;
    let device = default_device(source)?;
    let client: IAudioClient = unsafe { device.Activate(CLSCTX_ALL, None) }
        .map_err(|error| format!("Ouverture du périphérique impossible : {error}"))?;
    let format = unsafe { client.GetMixFormat() }
        .map_err(|error| format!("Format audio Windows non reconnu : {error}"))?;
    let flags = match source { CaptureSource::SystemAudio => AUDCLNT_STREAMFLAGS_LOOPBACK, CaptureSource::Microphone => Default::default() };
    unsafe { client.Initialize(AUDCLNT_SHAREMODE_SHARED, flags, 10_000_000, 0, format, None) }
        .map_err(|error| format!("Démarrage WASAPI impossible : {error}"))?;
    let capture: IAudioCaptureClient = unsafe { client.GetService() }
        .map_err(|error| format!("Service de capture inaccessible : {error}"))?;

    let sample_rate = unsafe { (*format).nSamplesPerSec };
    let channels = unsafe { (*format).nChannels };
    let bits = unsafe { (*format).wBitsPerSample };
    buffer.lock().map_err(|_| "Tampon audio indisponible")?.configure(sample_rate, channels);
    unsafe { client.Start() }.map_err(|error| format!("La capture audio n'a pas démarré : {error}"))?;

    while !stop.load(Ordering::SeqCst) {
        let packet_size = unsafe { capture.GetNextPacketSize() }
            .map_err(|error| format!("Lecture audio interrompue : {error}"))?;
        if packet_size == 0 { std::thread::sleep(POLL_INTERVAL); continue; }

        let mut data = std::ptr::null_mut();
        let mut frames = 0u32;
        let mut packet_flags = 0u32;
        unsafe { capture.GetBuffer(&mut data, &mut frames, &mut packet_flags, None, None) }
            .map_err(|error| format!("Bloc audio illisible : {error}"))?;
        let bytes_len = frames as usize * unsafe { (*format).nBlockAlign as usize };
        let silent = data.is_null() || bytes_len == 0 || packet_flags & 0x2 != 0;
        let samples = if silent {
            vec![0; frames as usize * channels as usize]
        } else {
            to_pcm16(unsafe { std::slice::from_raw_parts(data, bytes_len) }, bits)
        };
        let (rms, peak) = calculate_level(&samples);
        if let Ok(mut audio) = buffer.lock() { audio.extend(samples); }
        update_meter(meter, rms, peak, started);
        unsafe { capture.ReleaseBuffer(frames) }
            .map_err(|error| format!("Libération du bloc audio impossible : {error}"))?;
    }

    unsafe { client.Stop() }.ok();
    unsafe { windows::Win32::System::Com::CoTaskMemFree(Some(format.cast())) };
    Ok(())
}

fn to_pcm16(bytes: &[u8], bits: u16) -> Vec<i16> {
    match bits {
        16 => bytes.chunks_exact(2).map(|b| i16::from_le_bytes([b[0], b[1]])).collect(),
        32 => bytes.chunks_exact(4).map(|b| {
            let value = f32::from_le_bytes([b[0], b[1], b[2], b[3]]);
            if value.is_finite() { (value.clamp(-1.0, 1.0) * i16::MAX as f32) as i16 } else { 0 }
        }).collect(),
        _ => Vec::new(),
    }
}

fn calculate_level(samples: &[i16]) -> (f32, f32) {
    if samples.is_empty() { return (0.0, 0.0); }
    let peak = samples.iter().map(|s| (*s as f32 / i16::MAX as f32).abs()).fold(0.0f32, f32::max);
    let rms = (samples.iter().map(|s| { let v = *s as f32 / i16::MAX as f32; v * v }).sum::<f32>() / samples.len() as f32).sqrt();
    (rms, peak)
}
