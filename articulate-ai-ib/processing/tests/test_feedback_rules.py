import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from articulate_job.depth import depth_for  # noqa: E402
from articulate_job.feedback import Expectations, TranscriptIndex, fmt_ts, validate  # noqa: E402
from articulate_job.metrics import compute  # noqa: E402


def words(text, start=0.0, step=0.5):
    out, t = [], start
    for w in text.split():
        out.append({"start": t, "end": t + 0.4, "word": w})
        t += step
    return out


TRANSCRIPT = {
    "duration": 60.0,
    "segments": [
        {"start": 0.0, "end": 5.0, "text": "Good morning everyone. Um, today I want to talk about RAG.", "words": words("Good morning everyone. Um, today I want to talk about RAG.")},
        {"start": 10.0, "end": 15.0, "text": "We chose RAG because, basically, our documents change.", "words": words("We chose RAG because, basically, our documents change.", start=10.0)},
    ],
}
METRICS = {"words_per_minute": 120, "filler_word_count": 1, "filler_words_per_minute": 0.5, "long_pauses_over_3s": 1, "duration_seconds": 60, "detail": {}}
GENERAL = ["clarity_structure", "delivery_voice", "audience_fit", "conciseness_focus", "presence_confidence"]
SPECIAL = ["technical_correctness", "trade_off_reasoning", "scalability_operations", "security_governance", "explaining_complexity_simply"]


def expectations(level=3):
    return Expectations(
        categories=[(k, True) for k in GENERAL] + [(k, False) for k in SPECIAL],
        judge_ids=["j1", "j2"],
        audience_keys=["ctos", "ai_architects"],
        depth=depth_for(level),
        domain_key="ai_architecture",
    )


def raw_feedback(quote="We chose RAG because, basically, our documents change", score=3):
    return {
        "domain_key": "wrong",
        "overall_summary": "Good talk.",
        "delivery_metrics": {"words_per_minute": 999},
        "categories": [
            {"category_key": k, "score": score, "evidence": [{"timestamp": "00:00", "quote": quote}, {"timestamp": "00:01", "quote": "today I want to talk about RAG"}],
             "judges": {"consensus": "ok", "disagreements": None, "by_judge": [{"judge_id": "j1", "comment": "fine"}, {"judge_id": "ghost", "comment": "x"}]},
             "audience_notes": [{"audience_key": "ctos", "note": "n"}, {"audience_key": "hr", "note": "not selected"}],
             "improvement": "Do better."}
            for k in GENERAL + SPECIAL
        ],
        "audience_fit": [{"audience_key": "ctos", "rating": "served_well", "note": "n"}, {"audience_key": "ai_architects", "rating": "underserved", "note": "n"}],
        "audience_gaps": [],
        "top_strengths": ["a"], "top_priorities": ["b"],
    }


def test_valid_feedback_is_cleaned():
    fb, warnings = validate(raw_feedback(), expectations(), TranscriptIndex.from_transcript(TRANSCRIPT), METRICS)
    assert warnings == []
    assert fb["domain_key"] == "ai_architecture"
    assert fb["delivery_metrics"]["words_per_minute"] == 120
    c = fb["categories"][0]
    assert c["evidence"][0] == {"timestamp": "00:10", "quote": "We chose RAG because, basically, our documents change"}
    assert [j["judge_id"] for j in c["judges"]["by_judge"]] == ["j1", "j2"]
    assert c["judges"]["by_judge"][1]["comment"] is None
    assert [n["audience_key"] for n in c["audience_notes"]] == ["ctos"]
    assert fb["audience_gaps"] == ["ai_architects"]


def test_invented_quotes_are_dropped_and_reported():
    fb, warnings = validate(raw_feedback(quote="we will cut costs by ninety percent"), expectations(), TranscriptIndex.from_transcript(TRANSCRIPT), METRICS)
    assert all(len(c["evidence"]) == 1 for c in fb["categories"])
    assert sum(w.startswith("Dropped a quote") for w in warnings) == 10


def test_quotes_survive_whisper_word_splits():
    t = {"duration": 10.0, "segments": [{"start": 4.0, "end": 9.0, "text": "", "words": [
        {"start": 4.0, "end": 4.3, "word": "about"}, {"start": 4.3, "end": 4.6, "word": "$20"}, {"start": 4.6, "end": 4.9, "word": ",000"},
        {"start": 5.0, "end": 5.3, "word": "and"}, {"start": 5.3, "end": 5.6, "word": "fine"}, {"start": 5.6, "end": 5.9, "word": "-tuning"},
        {"start": 6.0, "end": 6.3, "word": "would"}, {"start": 6.3, "end": 6.6, "word": "lag."}]}]}
    idx = TranscriptIndex.from_transcript(t)
    assert idx.locate("about $20,000, and fine-tuning would lag") == 4.0
    assert idx.locate("and fine tuning would lag") == 5.0
    assert idx.locate("and retraining would lag") is None


def test_depth_one_keeps_one_quote():
    fb, _ = validate(raw_feedback(), expectations(level=1), TranscriptIndex.from_transcript(TRANSCRIPT), METRICS)
    assert all(len(c["evidence"]) == 1 for c in fb["categories"])


@pytest.mark.parametrize("score", [0, 6, 2.5, "4", None])
def test_bad_scores_are_rejected(score):
    with pytest.raises(ValueError):
        validate(raw_feedback(score=score), expectations(), TranscriptIndex.from_transcript(TRANSCRIPT), METRICS)


def test_wrong_category_set_is_rejected():
    raw = raw_feedback()
    raw["categories"] = raw["categories"][:9]
    with pytest.raises(ValueError, match="missing"):
        validate(raw, expectations(), TranscriptIndex.from_transcript(TRANSCRIPT), METRICS)


def test_metrics_counts_fillers_pauses_and_pace():
    t = {"duration": 30.0, "segments": [{"start": 0, "end": 1, "text": "", "words": words("Um so you know we uh built it", step=0.5) + words("then later", start=10.0)}]}
    m = compute(t)
    assert m["filler_word_count"] == 3
    assert m["long_pauses_over_3s"] == 1
    assert m["duration_seconds"] == 30
    assert m["words_per_minute"] > 0


def test_fmt_ts():
    assert fmt_ts(72.4) == "01:12"
    assert fmt_ts(3723) == "1:02:03"
