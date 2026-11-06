"""transcribe: speech-to-text with word timestamps for every recording in the session."""
from __future__ import annotations

import os
import shutil
import subprocess
import tempfile

import numpy as np
from faster_whisper import WhisperModel

from .context import StepContext
from .media import FFMPEG

# Whisper tends to clean up disfluencies; priming with fillers keeps them in the transcript for the metrics step.
FILLER_PROMPT = "Um, uh, er, so, you know, I mean, like, basically. Erm, right."
SAMPLE_RATE = 16000


def load_audio(path: str) -> np.ndarray:
    # Decode with our ffmpeg rather than faster-whisper's PyAV path, whose API breaks on the serverless image.
    raw = subprocess.run(
        [FFMPEG, "-hide_banner", "-nostdin", "-i", path, "-f", "f32le", "-ac", "1", "-ar", str(SAMPLE_RATE), "-"],
        capture_output=True, check=True,
    ).stdout
    return np.frombuffer(raw, dtype=np.float32)


def transcribe_file(model: WhisperModel, path: str) -> dict:
    segments, info = model.transcribe(
        load_audio(path), word_timestamps=True, initial_prompt=FILLER_PROMPT, vad_filter=False, condition_on_previous_text=False
    )
    out = []
    for s in segments:
        out.append({
            "start": round(s.start, 2),
            "end": round(s.end, 2),
            "text": s.text.strip(),
            "words": [{"start": round(w.start, 2), "end": round(w.end, 2), "word": w.word.strip()} for w in (s.words or [])],
        })
    return {"language": info.language, "duration": round(info.duration, 2), "segments": out}


def run(ctx: StepContext) -> None:
    cache = os.path.join(tempfile.gettempdir(), "whisper-models")
    model = WhisperModel(ctx.config.whisper_model, device="cpu", compute_type="int8", download_root=cache, cpu_threads=os.cpu_count() or 4)

    for m in ctx.media():
        if not m["audio_path"]:
            raise RuntimeError(f"Media {m['media_id']} has no converted audio; prepare_media did not finish")
        with tempfile.TemporaryDirectory() as tmp:
            local = os.path.join(tmp, "audio.mp3")
            shutil.copy(ctx.volume_path(m["audio_path"]), local)
            transcript = transcribe_file(model, local)
        transcript.update({"media_id": m["media_id"], "role": m["role"], "judge_id": str(m["judge_id"]) if m["judge_id"] else None})
        rel = f"transcripts/{ctx.config.session_id}/{m['media_id']}.json"
        ctx.write_json(rel, transcript)
        ctx.execute(
            "UPDATE articulate.session_media SET transcript_path = %s, duration_seconds = %s WHERE media_id = %s",
            [rel, transcript["duration"], m["media_id"]],
        )
