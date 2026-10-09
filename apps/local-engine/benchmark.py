"""Mesure locale de reconnaissance ; jamais une note de qualité de traduction."""
import argparse
import io
import json
import re
import time
import wave
from pathlib import Path


def word_error_rate(reference, actual):
    expected = re.findall(r"\w+", reference.casefold())
    observed = re.findall(r"\w+", actual.casefold())
    if not expected:
        raise ValueError("La transcription de référence doit contenir des mots")
    row = list(range(len(observed) + 1))
    for index, word in enumerate(expected, 1):
        next_row = [index]
        for offset, found in enumerate(observed, 1):
            next_row.append(min(row[offset] + 1, next_row[-1] + 1, row[offset - 1] + (word != found)))
        row = next_row
    return {"referenceWords": len(expected), "errors": row[-1], "wer": row[-1] / len(expected)}


def main():
    parser = argparse.ArgumentParser(description="Tester un extrait réel de 10 à 60 secondes avec une transcription humaine")
    parser.add_argument("audio", type=Path)
    parser.add_argument("reference", type=Path)
    parser.add_argument("--source", choices=["en", "fr", "es", "zh"], required=True)
    parser.add_argument("--target", choices=["en", "fr", "es", "zh"], default="fr")
    parser.add_argument("--output", type=Path, default=Path("rapport-precision.json"))
    args = parser.parse_args()
    from offline_guard import enable
    enable()
    from engine import LocalEngine
    import numpy as np
    engine = LocalEngine()
    audio = engine.audio_decoder(str(args.audio), sampling_rate=16000)
    duration = len(audio) / 16000
    if not 10 <= duration <= 60:
        raise ValueError("Utilisez un extrait entre 10 et 60 secondes")
    latest, timings = {}, []
    for start in range(0, len(audio), 48000):
        buffer = io.BytesIO()
        with wave.open(buffer, "wb") as wav:
            wav.setnchannels(1); wav.setsampwidth(2); wav.setframerate(16000)
            wav.writeframes((np.clip(audio[start:start + 48000], -1, 1) * 32767).astype('<i2').tobytes())
        began = time.perf_counter()
        events = engine.process(buffer.getvalue(), args.source, args.target)
        timings.append(time.perf_counter() - began)
        for event in events:
            latest[event["id"]] = event
    began = time.perf_counter()
    for event in engine.finish(args.target):
        latest[event["id"]] = event
    finalization = time.perf_counter() - began
    actual = " ".join(event["original"] for event in latest.values())
    report = {**word_error_rate(args.reference.read_text(encoding="utf-8-sig"), actual),
              "recognized": actual, "audioSeconds": duration, "processingSeconds": sum(timings) + finalization, "finalizationSeconds": finalization,
              "realTimeFactor": (sum(timings) + finalization) / duration, "chunkSeconds": timings,
              "mode": "precision" if engine.precision else "normal",
              "note": "WER : erreurs de reconnaissance. Ne mesure pas la qualité de traduction. Chargement des modèles exclu."}
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Rapport enregistré : {args.output}")


if __name__ == "__main__":
    main()
