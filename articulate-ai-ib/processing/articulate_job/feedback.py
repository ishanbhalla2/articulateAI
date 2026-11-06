"""generate_feedback: build the prompt from Settings, call the model, validate the JSON (spec sections 6 and 7)."""
from __future__ import annotations

import glob
import json
import re
from dataclasses import dataclass, field

from . import llm
from .classify import topic_text
from .context import StepContext
from .depth import Depth, depth_for
from .prompts import load_prompt

PROMPT_VERSION = "feedback_v1"
FIT_RATINGS = {"served_well", "partly", "underserved"}

SCHEMA_EXAMPLE = {
    "domain_key": "<domain key>",
    "overall_summary": "2-4 sentences",
    "delivery_metrics": {"words_per_minute": 0, "filler_word_count": 0, "filler_words_per_minute": 0.0, "long_pauses_over_3s": 0, "duration_seconds": 0},
    "categories": [{
        "category_key": "<key>", "is_general": True, "score": 3,
        "evidence": [{"timestamp": "01:12", "quote": "exact words from the participant transcript"}],
        "judges": {"consensus": "or null", "disagreements": "or null",
                   "by_judge": [{"judge_id": "<judge_id>", "comment": "or null", "lens_note": "or null"}]},
        "audience_notes": [{"audience_key": "<key>", "note": "how this category landed for them"}],
        "improvement": "one concrete, actionable suggestion",
    }],
    "audience_fit": [{"audience_key": "<key>", "rating": "served_well | partly | underserved", "note": "..."}],
    "audience_gaps": ["<key>"],
    "top_strengths": ["..."],
    "top_priorities": ["..."],
}


def fmt_ts(seconds: float) -> str:
    s = int(round(seconds))
    h, rem = divmod(s, 3600)
    m, sec = divmod(rem, 60)
    return f"{h}:{m:02d}:{sec:02d}" if h else f"{m:02d}:{sec:02d}"


def _letters(text: str) -> str:
    return re.sub(r"[^0-9a-z]", "", text.lower())


@dataclass
class TranscriptIndex:
    # Match on letters and digits only: Whisper splits "fine-tuning" or "$20,000" across word tokens,
    # so token-by-token comparison rejects quotes the model copied correctly.
    chars: str = ""
    starts: list[float] = field(default_factory=list)

    @classmethod
    def from_transcript(cls, transcript: dict) -> "TranscriptIndex":
        parts: list[str] = []
        starts: list[float] = []
        for seg in transcript["segments"]:
            for w in seg.get("words") or [{"word": seg["text"], "start": seg["start"]}]:
                norm = _letters(w["word"])
                parts.append(norm)
                starts.extend([float(w["start"])] * len(norm))
        return cls("".join(parts), starts)

    def locate(self, quote: str) -> float | None:
        q = _letters(quote)
        if len(q) < 12:
            return None
        i = self.chars.find(q)
        return self.starts[i] if i >= 0 else None


@dataclass
class Expectations:
    categories: list[tuple[str, bool]]
    judge_ids: list[str]
    audience_keys: list[str]
    depth: Depth
    domain_key: str


def validate(raw: dict, exp: Expectations, index: TranscriptIndex, metrics: dict) -> tuple[dict, list[str]]:
    """Return (clean feedback, warnings). Raises ValueError for structural problems worth a retry."""
    cats = raw.get("categories")
    if not isinstance(cats, list):
        raise ValueError("`categories` must be a list")
    by_key = {c.get("category_key"): c for c in cats if isinstance(c, dict)}
    expected_keys = [k for k, _ in exp.categories]
    missing = [k for k in expected_keys if k not in by_key]
    extra = [k for k in by_key if k not in expected_keys]
    if missing or extra or len(cats) != len(expected_keys):
        raise ValueError(f"Expected exactly these categories {expected_keys}; missing {missing}, unexpected {extra}")

    warnings: list[str] = []
    clean_cats = []
    for key, is_general in exp.categories:
        c = by_key[key]
        score = c.get("score")
        if isinstance(score, float) and score.is_integer():
            score = int(score)
        if not isinstance(score, int) or isinstance(score, bool) or not 1 <= score <= 5:
            raise ValueError(f"Category {key} has score {score!r}; scores must be whole numbers 1-5")

        evidence = []
        for e in c.get("evidence") or []:
            quote = str((e or {}).get("quote", "")).strip().strip('"“”')
            start = index.locate(quote)
            if start is None:
                warnings.append(f"Dropped a quote for {key} that is not in the transcript: “{quote[:80]}”")
                continue
            evidence.append({"timestamp": fmt_ts(start), "quote": quote})
        if len(evidence) > exp.depth.max_quotes:
            evidence = evidence[: exp.depth.max_quotes]
        if len(evidence) < exp.depth.min_quotes:
            warnings.append(f"{key} has {len(evidence)} verified quote(s); depth {exp.depth.level} asks for {exp.depth.min_quotes}")

        judges_raw = c.get("judges") or {}
        given = {str(j.get("judge_id")): j for j in judges_raw.get("by_judge") or [] if isinstance(j, dict)}
        by_judge = [
            {"judge_id": jid, "comment": (given.get(jid) or {}).get("comment") or None, "lens_note": (given.get(jid) or {}).get("lens_note") or None}
            for jid in exp.judge_ids
        ]
        notes = [
            {"audience_key": n["audience_key"], "note": str(n.get("note", ""))}
            for n in c.get("audience_notes") or []
            if isinstance(n, dict) and n.get("audience_key") in exp.audience_keys
        ]
        clean_cats.append({
            "category_key": key,
            "is_general": is_general,
            "score": score,
            "evidence": evidence,
            "judges": {"consensus": judges_raw.get("consensus") or None, "disagreements": judges_raw.get("disagreements") or None, "by_judge": by_judge},
            "audience_notes": notes,
            "improvement": str(c.get("improvement") or "").strip(),
        })

    fit = []
    for a in raw.get("audience_fit") or []:
        if isinstance(a, dict) and a.get("audience_key") in exp.audience_keys:
            rating = a.get("rating") if a.get("rating") in FIT_RATINGS else "partly"
            fit.append({"audience_key": a["audience_key"], "rating": rating, "note": str(a.get("note", ""))})
    missing_fit = [k for k in exp.audience_keys if k not in {f["audience_key"] for f in fit}]
    if missing_fit:
        raise ValueError(f"`audience_fit` is missing audiences {missing_fit}")

    gaps = [g for g in raw.get("audience_gaps") or [] if g in exp.audience_keys]
    gaps = sorted(set(gaps) | {f["audience_key"] for f in fit if f["rating"] == "underserved"}, key=exp.audience_keys.index)

    metrics_out = {k: metrics[k] for k in ("words_per_minute", "filler_word_count", "filler_words_per_minute", "long_pauses_over_3s", "duration_seconds")}
    return {
        "domain_key": exp.domain_key,
        "overall_summary": str(raw.get("overall_summary") or "").strip(),
        "delivery_metrics": metrics_out,
        "categories": clean_cats,
        "audience_fit": fit,
        "audience_gaps": gaps,
        "top_strengths": [str(s) for s in (raw.get("top_strengths") or [])][:5],
        "top_priorities": [str(s) for s in (raw.get("top_priorities") or [])][:5],
    }, warnings


def _depth_text(d: Depth, has_frames: bool) -> str:
    quotes = f"{d.min_quotes}" if d.min_quotes == d.max_quotes else f"{d.min_quotes} to {d.max_quotes}"
    lines = [f"Give {quotes} evidence quote(s) per category."]
    if d.self_check:
        lines.append("Before answering, check every quote appears word for word in the participant transcript and every score matches its anchors; fix any that do not.")
    if d.reconcile_judges:
        lines.append("Reconcile the judges category by category: state where they agree, where they differ, and which view better serves the selected audiences.")
    if has_frames:
        lines.append("Still frames sampled evenly from the participant's video are attached. Use them for body language, eye contact and composure under Presence & Confidence only.")
    else:
        lines.append("No video is available: judge Presence & Confidence from what is said and the delivery metrics only.")
    return "\n".join(lines)


def build_context(ctx: StepContext) -> dict:
    session = ctx.session()
    snapshot = session["settings_snapshot"] or {}
    depth = depth_for(snapshot.get("depth_level", 3))
    settings = ctx.query("SELECT llm_instructions FROM articulate.app_settings WHERE version = %s", [snapshot.get("instructions_version")])
    if not settings:
        raise RuntimeError("The settings version recorded for this session no longer exists")
    target = llm.resolve_target(ctx.query, snapshot.get("provider"), snapshot.get("model_id"))

    media = ctx.media()
    judges = {str(j["judge_id"]): j for j in ctx.judges()}
    judge_media = [m for m in media if m["role"] == "judge"]
    participant = next(m for m in media if m["role"] == "participant")
    participant_t = ctx.read_json(participant["transcript_path"])

    audiences = ctx.query(
        """SELECT ap.* FROM articulate.session_audiences sa JOIN articulate.audience_profiles ap USING (audience_key)
            WHERE sa.session_id = %s ORDER BY ap.display_order""",
        [ctx.config.session_id],
    )
    domain_key = session["domain_key"]
    general = ctx.query("SELECT * FROM articulate.category_library WHERE is_general AND status = 'active' ORDER BY display_order")
    if session["is_provisional"]:
        proposal = ctx.query(
            "SELECT proposed_domain_name, proposed_categories FROM articulate.domain_proposals WHERE session_id = %s ORDER BY created_at DESC LIMIT 1",
            [ctx.config.session_id],
        )[0]
        domain_name = proposal["proposed_domain_name"] + " (provisional)"
        specialised = proposal["proposed_categories"]
    else:
        specialised = ctx.query(
            "SELECT * FROM articulate.category_library WHERE domain_key = %s AND status = 'active' ORDER BY display_order", [domain_key]
        )
        domain_name = specialised[0]["domain_name"] if specialised else domain_key
    if len(general) != 5 or len(specialised) != 5:
        raise RuntimeError(f"Expected 5 general and 5 specialised categories, found {len(general)} and {len(specialised)}")

    frames: list[str] = []
    if participant["media_type"] == "video" and depth.frame_count and (target["accepts_image"] or target["accepts_video"]):
        frames = sorted(glob.glob(ctx.volume_path(f"frames/{ctx.config.session_id}/{participant['media_id']}/*.jpg")))

    return {
        "session": session, "snapshot": snapshot, "depth": depth, "instructions": settings[0]["llm_instructions"], "target": target,
        "judges": judges, "judge_media": judge_media, "participant_t": participant_t, "audiences": audiences,
        "domain_key": domain_key, "domain_name": domain_name, "general": general, "specialised": specialised,
        "topic": topic_text(ctx, session, media), "frames": frames,
        "metrics": ctx.read_json(f"transcripts/{ctx.config.session_id}/metrics.json"),
    }


def build_prompt(ctx: StepContext, c: dict) -> str:
    def cat_block(cat: dict, general: bool) -> str:
        return (f"- `{cat['category_key']}` ({'general' if general else 'specialised'}) {cat['category_name']}: {cat['description']}\n"
                f"  1: {cat['anchor_1']}\n  3: {cat['anchor_3']}\n  5: {cat['anchor_5']}")

    categories = "\n".join([cat_block(x, True) for x in c["general"]] + [cat_block(x, False) for x in c["specialised"]])
    audiences = "\n".join(
        f"- `{a['audience_key']}` {a['display_name']} (depth: {a['depth']}). Cares about: {a['cares_about']}. Common presenter mistakes: {a['common_mistakes']}"
        for a in c["audiences"]
    )
    judge_blocks = []
    for m in c["judge_media"]:
        j = c["judges"][str(m["judge_id"])]
        text = " ".join(s["text"] for s in ctx.read_json(m["transcript_path"])["segments"])
        judge_blocks.append(f"### Judge `{j['judge_id']}`: {j['name'] or 'Judge ' + str(j['position'])}, {j['role'] or 'role not given'}\n{text}")
    participant = "\n".join(f"[{fmt_ts(s['start'])}] {s['text']}" for s in c["participant_t"]["segments"])
    m = c["metrics"]
    metrics = (
        "## Delivery metrics (measured from the recording)\n" + json.dumps({k: v for k, v in m.items() if k != "detail"}) +
        f"\nFillers heard: {json.dumps(m['detail']['fillers'])}. Long pauses (seconds): {[p['seconds'] for p in m['detail']['long_pauses']]}"
        if c["depth"].include_metrics else "## Delivery metrics\nNot provided at this depth."
    )
    instructions = (
        c["instructions"].replace("{topic}", c["topic"] or "")
        .replace("{domain}", c["domain_name"]).replace("{audiences}", ", ".join(a["display_name"] for a in c["audiences"]))
        .replace("{judges}", ", ".join(f"{j['name'] or 'Judge'} ({j['role'] or 'role not given'})" for j in c["judges"].values()))
        .replace("{categories}", ", ".join(x["category_name"] for x in c["general"] + c["specialised"]))
    )
    keys = [x["category_key"] for x in c["general"]] + [x["category_key"] for x in c["specialised"]]
    replacements = {
        "{instructions}": instructions, "{topic}": c["topic"] or "(not given)", "{domain}": c["domain_name"],
        "{audiences}": audiences, "{categories}": categories, "{judges}": "\n\n".join(judge_blocks), "{participant}": participant,
        "{metrics}": metrics, "{depth}": _depth_text(c["depth"], bool(c["frames"])),
        "{schema}": json.dumps(SCHEMA_EXAMPLE, indent=1), "{category_keys}": ", ".join(keys),
        "{audience_keys}": ", ".join(a["audience_key"] for a in c["audiences"]),
    }
    prompt = load_prompt(PROMPT_VERSION)
    for k, v in replacements.items():
        prompt = prompt.replace(k, v)
    return prompt


SYSTEM = "You are an expert presentation coach producing structured, evidence-based feedback. Reply with one JSON object only."


def run(ctx: StepContext) -> None:
    c = build_context(ctx)
    depth: Depth = c["depth"]
    prompt = build_prompt(ctx, c)
    user: str | list = prompt if not c["frames"] else [{"type": "text", "text": prompt}, *[llm.image_part(f) for f in c["frames"]]]
    exp = Expectations(
        categories=[(x["category_key"], True) for x in c["general"]] + [(x["category_key"], False) for x in c["specialised"]],
        judge_ids=[str(m["judge_id"]) for m in c["judge_media"]],
        audience_keys=[a["audience_key"] for a in c["audiences"]],
        depth=depth,
        domain_key=c["domain_key"],
    )
    index = TranscriptIndex.from_transcript(c["participant_t"])
    endpoint = c["target"]["invoke_target"]
    usage_total: dict[str, int] = {}

    def call(extra: str = "") -> dict:
        content = user if not extra else (user + extra if isinstance(user, str) else [{"type": "text", "text": prompt + extra}, *user[1:]])
        text, usage = llm.chat(ctx.ws, endpoint, SYSTEM, content)
        for k, v in usage.items():
            if isinstance(v, int):
                usage_total[k] = usage_total.get(k, 0) + v
        return llm.parse_json(text)

    def attempt(extra: str = "") -> tuple[dict, list[str]]:
        raw = call(extra)
        try:
            return validate(raw, exp, index, c["metrics"])
        except ValueError as err:
            raw = call(extra + f"\n\nYour previous answer was rejected: {err}. Return the complete corrected JSON.")
            return validate(raw, exp, index, c["metrics"])

    feedback, warnings = attempt()
    if depth.review_pass:
        review = (
            "\n\n## Review pass\nHere is a draft assessment. Review it against the anchors and the transcript: make sure each score is justified by its evidence, "
            "every quote is verbatim, and the judges' views are represented fairly"
            + (", reconciling the judges category by category" if depth.reconcile_judges else "")
            + ". Return the complete improved JSON.\n\n" + json.dumps(feedback)
        )
        feedback, warnings = attempt(review)

    ctx.write_json(f"transcripts/{ctx.config.session_id}/feedback.json", {
        "feedback": feedback,
        "warnings": warnings,
        "model_name": c["snapshot"].get("model_id"),
        "prompt_version": PROMPT_VERSION,
        "depth_level": depth.level,
        "frames_used": len(c["frames"]),
        "usage": usage_total,
    })
