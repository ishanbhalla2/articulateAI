"""prepare_media: join uploaded chunks, convert to MP3 for transcription and playback, sample video frames."""
from __future__ import annotations

import glob
import os
import re
import shutil
import subprocess
import tempfile

import imageio_ffmpeg

from .context import StepContext
from .depth import depth_for

FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()
_TIME = re.compile(r"time=(\d+):(\d+):(\d+\.\d+)")


def _run(args: list[str]) -> str:
    result = subprocess.run([FFMPEG, "-hide_banner", "-y", *args], capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"ffmpeg failed: {result.stderr[-800:]}")
    return result.stderr


def _decoded_duration(path: str) -> float | None:
    # MediaRecorder WebM files carry no duration header, so decode the stream and read ffmpeg's final timestamp
    matches = _TIME.findall(_run(["-i", path, "-f", "null", "-"]))
    if not matches:
        return None
    h, m, s = matches[-1]
    return int(h) * 3600 + int(m) * 60 + float(s)


def _join_parts(media_dir: str, target: str) -> None:
    parts = sorted(glob.glob(os.path.join(media_dir, "part-*")))
    if not parts:
        raise FileNotFoundError(f"No uploaded parts found in {media_dir}")
    with open(target, "wb") as out:
        for part in parts:
            with open(part, "rb") as f:
                shutil.copyfileobj(f, out, length=8 * 1024 * 1024)


def _wants_frames(ctx: StepContext, session: dict) -> tuple[int, int]:
    snapshot = session.get("settings_snapshot") or {}
    depth = depth_for(snapshot.get("depth_level", 3))
    if depth.frame_count == 0:
        return 0, 0
    rows = ctx.query(
        "SELECT accepts_image, accepts_video FROM articulate.model_catalog WHERE provider = %s AND model_id = %s",
        [snapshot.get("provider"), snapshot.get("model_id")],
    )
    if rows and (rows[0]["accepts_image"] or rows[0]["accepts_video"]):
        return depth.frame_count, depth.frame_width
    return 0, 0


def run(ctx: StepContext) -> None:
    session = ctx.session()
    frame_count, frame_width = _wants_frames(ctx, session)
    ctx.session_dir("audio")

    for m in ctx.media():
        with tempfile.TemporaryDirectory() as tmp:
            source = os.path.join(tmp, "source")
            _join_parts(ctx.volume_path(m["media_path"]), source)

            local_mp3 = os.path.join(tmp, "audio.mp3")
            _run(["-i", source, "-vn", "-ac", "1", "-ar", "16000", "-b:a", "64k", local_mp3])
            duration = _decoded_duration(local_mp3)
            audio_rel = f"audio/{ctx.config.session_id}/{m['media_id']}.mp3"
            shutil.copy(local_mp3, ctx.volume_path(audio_rel))

            if m["role"] == "participant" and m["media_type"] == "video" and frame_count and duration:
                frames_dir = ctx.volume_path(f"frames/{ctx.config.session_id}/{m['media_id']}")
                os.makedirs(frames_dir, exist_ok=True)
                fps = frame_count / max(duration, 1.0)
                local_frames = os.path.join(tmp, "frames")
                os.makedirs(local_frames)
                _run(["-i", source, "-vf", f"fps={fps:.5f},scale={frame_width}:-2", "-frames:v", str(frame_count), "-q:v", "4",
                      os.path.join(local_frames, "frame_%03d.jpg")])
                for f in sorted(os.listdir(local_frames)):
                    shutil.copy(os.path.join(local_frames, f), os.path.join(frames_dir, f))

            ctx.execute(
                "UPDATE articulate.session_media SET audio_path = %s, duration_seconds = COALESCE(%s, duration_seconds) WHERE media_id = %s",
                [audio_rel, round(duration, 2) if duration else None, m["media_id"]],
            )
