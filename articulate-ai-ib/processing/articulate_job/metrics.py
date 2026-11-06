"""delivery_metrics: pace, fillers and pauses computed from the participant's word timings, never by the LLM."""
from __future__ import annotations

import re

from .context import StepContext

SINGLE_FILLERS = {"um", "umm", "uh", "uhh", "uhm", "er", "erm", "ah", "hmm", "mm"}
PHRASE_FILLERS = [("you", "know"), ("i", "mean")]
LONG_PAUSE_SECONDS = 3.0


def _norm(word: str) -> str:
    return re.sub(r"[^\w']", "", word.lower())


def compute(transcript: dict) -> dict:
    words = [w for s in transcript["segments"] for w in s["words"]]
    tokens = [_norm(w["word"]) for w in words]

    fillers: dict[str, int] = {}
    for t in tokens:
        if t in SINGLE_FILLERS:
            fillers[t] = fillers.get(t, 0) + 1
    for a, b in PHRASE_FILLERS:
        n = sum(1 for i in range(len(tokens) - 1) if tokens[i] == a and tokens[i + 1] == b)
        if n:
            fillers[f"{a} {b}"] = n
    filler_count = sum(fillers.values())

    pauses = [
        {"after": round(prev["end"], 2), "seconds": round(cur["start"] - prev["end"], 2)}
        for prev, cur in zip(words, words[1:])
        if cur["start"] - prev["end"] > LONG_PAUSE_SECONDS
    ]

    duration = float(transcript.get("duration") or 0)
    speaking_span = (words[-1]["end"] - words[0]["start"]) if words else 0.0
    minutes = speaking_span / 60 if speaking_span > 0 else 0
    spoken = sum(1 for t in tokens if t and t not in SINGLE_FILLERS)

    return {
        "words_per_minute": round(spoken / minutes) if minutes else 0,
        "filler_word_count": filler_count,
        "filler_words_per_minute": round(filler_count / minutes, 1) if minutes else 0.0,
        "long_pauses_over_3s": len(pauses),
        "duration_seconds": round(duration),
        "detail": {"fillers": fillers, "long_pauses": pauses, "word_count": spoken, "speaking_span_seconds": round(speaking_span, 1)},
    }


def run(ctx: StepContext) -> None:
    participant = next((m for m in ctx.media() if m["role"] == "participant"), None)
    if not participant or not participant["transcript_path"]:
        raise RuntimeError("Participant transcript is missing")
    metrics = compute(ctx.read_json(participant["transcript_path"]))
    ctx.write_json(f"transcripts/{ctx.config.session_id}/metrics.json", metrics)
