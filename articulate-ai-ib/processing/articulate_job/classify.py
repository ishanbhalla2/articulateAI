"""classify_domain: pick a domain from the library, or propose a new one when nothing fits (spec 2.3)."""
from __future__ import annotations

import json
import re

from psycopg.types.json import Jsonb

from . import llm
from .context import StepContext
from .prompts import load_prompt

CONFIDENCE_THRESHOLD = 0.6
PROMPT_VERSION = "classify_v1"
KEY_PATTERN = re.compile(r"^[a-z][a-z0-9_]{1,62}$")


def topic_text(ctx: StepContext, session: dict, media: list[dict]) -> str:
    if session.get("topic_text"):
        return session["topic_text"]
    topic = next((m for m in media if m["role"] == "topic"), None)
    if topic and topic["transcript_path"]:
        return " ".join(s["text"] for s in ctx.read_json(topic["transcript_path"])["segments"])
    return ""


def _library(ctx: StepContext) -> dict[str, dict]:
    rows = ctx.query(
        "SELECT domain_key, domain_name, category_name, description FROM articulate.category_library WHERE NOT is_general AND status = 'active' ORDER BY domain_key, display_order"
    )
    library: dict[str, dict] = {}
    for r in rows:
        d = library.setdefault(r["domain_key"], {"domain_key": r["domain_key"], "domain_name": r["domain_name"], "categories": []})
        d["categories"].append(f"{r['category_name']}: {r['description']}")
    return library


def _validate_proposal(p: dict, taken: set[str]) -> dict:
    cats = p.get("categories") or []
    if len(cats) != 5:
        raise ValueError("Proposed domain must have exactly 5 categories")
    fields = ["category_key", "category_name", "description", "anchor_1", "anchor_3", "anchor_5"]
    clean = [{f: str(c.get(f, "")).strip() for f in fields} for c in cats]
    if any(not all(c.values()) or not KEY_PATTERN.match(c["category_key"]) for c in clean):
        raise ValueError("Proposed categories are incomplete")
    key = re.sub(r"[^a-z0-9_]", "_", str(p.get("domain_key", "")).lower()).strip("_") or "proposed_domain"
    base, n = key, 2
    while key in taken:
        key, n = f"{base}_{n}", n + 1
    return {"domain_key": key, "domain_name": str(p.get("domain_name") or key.replace("_", " ").title()), "categories": clean}


def run(ctx: StepContext) -> None:
    session = ctx.session()
    if session["domain_source"] == "user" and session["domain_key"]:
        return

    media = ctx.media()
    participant = next(m for m in media if m["role"] == "participant")
    words = " ".join(s["text"] for s in ctx.read_json(participant["transcript_path"])["segments"]).split()
    library = _library(ctx)
    snapshot = session["settings_snapshot"] or {}
    target = llm.resolve_target(ctx.query, snapshot.get("provider"), snapshot.get("model_id"))

    prompt = (
        load_prompt(PROMPT_VERSION)
        .replace("{topic}", topic_text(ctx, session, media) or "(no topic given)")
        .replace("{excerpt}", " ".join(words[:1500]))
        .replace("{library}", json.dumps(list(library.values()), indent=1))
    )
    result: dict = {}
    for attempt in range(2):
        text, _ = llm.chat(ctx.ws, target["invoke_target"], "You classify talks into feedback domains. Reply with JSON only.", prompt, max_tokens=4000)
        try:
            result = llm.parse_json(text)
            chosen = result.get("domain_key")
            confident = chosen in library and float(result.get("confidence") or 0) >= CONFIDENCE_THRESHOLD
            if confident:
                ctx.execute(
                    "UPDATE articulate.sessions SET domain_key = %s, domain_source = 'auto', is_provisional = false WHERE session_id = %s",
                    [chosen, ctx.config.session_id],
                )
                return
            proposal = _validate_proposal(result.get("proposal") or {}, set(library))
            break
        except (ValueError, TypeError) as err:
            if attempt == 1:
                raise RuntimeError(f"Domain classification returned unusable output: {err}") from err
            prompt += f"\n\nYour previous reply could not be used ({err}). Return valid JSON that follows the format exactly."

    with ctx.db() as conn:
        conn.execute(
            """INSERT INTO articulate.domain_proposals (session_id, proposed_domain_key, proposed_domain_name, proposed_categories)
               VALUES (%s, %s, %s, %s)""",
            [ctx.config.session_id, proposal["domain_key"], proposal["domain_name"], Jsonb(proposal["categories"])],
        )
        conn.execute(
            "UPDATE articulate.sessions SET domain_key = %s, domain_source = 'auto', is_provisional = true WHERE session_id = %s",
            [proposal["domain_key"], ctx.config.session_id],
        )
