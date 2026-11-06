"""Model calls through Databricks serving endpoints (OpenAI-compatible chat format)."""
from __future__ import annotations

import base64
import json
import re
import time

from databricks.sdk import WorkspaceClient


PERMANENT_ERRORS = {"BAD_REQUEST", "INVALID_PARAMETER_VALUE", "PERMISSION_DENIED", "RESOURCE_DOES_NOT_EXIST", "NOT_FOUND"}


class ModelError(RuntimeError):
    pass


def resolve_target(ctx_query, provider: str, model_id: str) -> dict:
    rows = ctx_query(
        "SELECT invoke_target, accepts_image, accepts_audio, accepts_video, enabled FROM articulate.model_catalog WHERE provider = %s AND model_id = %s",
        [provider, model_id],
    )
    if not rows or not rows[0]["enabled"]:
        raise ModelError(f"Model {provider}/{model_id} is not in the model catalog or is disabled")
    if provider != "databricks":
        raise ModelError(f"Provider '{provider}' is not supported by the processing job yet; choose a Databricks model in Settings")
    return rows[0]


def image_part(path: str) -> dict:
    with open(path, "rb") as f:
        data = base64.b64encode(f.read()).decode()
    return {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{data}"}}


def _content_text(message: dict) -> str:
    content = message.get("content")
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "".join(p.get("text", "") for p in content if isinstance(p, dict) and p.get("type") in (None, "text"))
    return ""


def chat(ws: WorkspaceClient, endpoint: str, system: str, user: str | list, max_tokens: int = 16000, attempts: int = 3) -> tuple[str, dict]:
    # no temperature: current Claude models on Databricks reject it
    body = {
        "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
        "max_tokens": max_tokens,
    }
    for attempt in range(1, attempts + 1):
        try:
            response = ws.api_client.do("POST", f"/serving-endpoints/{endpoint}/invocations", body=body)
            return _content_text(response["choices"][0]["message"]), response.get("usage") or {}
        except Exception as err:  # noqa: BLE001 - rate limits and transient 5xx surface as generic SDK errors
            permanent = getattr(err, "error_code", None) in PERMANENT_ERRORS
            if permanent or attempt == attempts:
                raise ModelError(f"Model call to {endpoint} failed: {err}") from err
            time.sleep(5 * attempt)
    raise AssertionError("unreachable")


def parse_json(text: str) -> dict:
    cleaned = re.sub(r"^```(?:json)?\s*|\s*```$", "", text.strip())
    start, end = cleaned.find("{"), cleaned.rfind("}")
    if start == -1 or end == -1:
        raise ValueError("The model did not return a JSON object")
    return json.loads(cleaned[start : end + 1])
