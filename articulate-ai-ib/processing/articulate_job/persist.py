"""persist: store the validated feedback in Lakebase and the per-category scores in Delta."""
from __future__ import annotations

from datetime import datetime, timezone

from psycopg.types.json import Jsonb

from .context import StepContext


def _status_detail(result: dict) -> str | None:
    warnings = result.get("warnings") or []
    if not warnings:
        return None
    dropped = sum(1 for w in warnings if w.startswith("Dropped a quote"))
    parts = []
    if dropped:
        parts.append(f"{dropped} quote(s) were removed because they did not match the transcript")
    if len(warnings) > dropped:
        parts.append(f"{len(warnings) - dropped} categor{'y has' if len(warnings) - dropped == 1 else 'ies have'} fewer quotes than the depth level asks for")
    return "Complete. " + "; ".join(parts) + "."


def write_delta(ctx: StepContext, session: dict, result: dict, audiences: list[str], judge_count: int) -> None:
    from pyspark.sql import SparkSession

    spark = SparkSession.builder.getOrCreate()
    fb = result["feedback"]
    created = session["created_at"] if session["created_at"].tzinfo else session["created_at"].replace(tzinfo=timezone.utc)
    rows = [
        (ctx.config.session_id, session["participant_name"], created.astimezone(timezone.utc).replace(tzinfo=None), fb["domain_key"],
         c["category_key"], c["is_general"], int(c["score"]), audiences, judge_count, result["model_name"], int(result["depth_level"]),
         result["prompt_version"])
        for c in fb["categories"]
    ]
    table = ctx.config.delta_table
    # retries re-run persist, so replace this session's rows rather than appending duplicates
    spark.sql(f"DELETE FROM {table} WHERE session_id = :sid", args={"sid": ctx.config.session_id})
    spark.createDataFrame(rows, schema=spark.table(table).schema).write.mode("append").saveAsTable(table)


def run(ctx: StepContext) -> None:
    session = ctx.session()
    result = ctx.read_json(f"transcripts/{ctx.config.session_id}/feedback.json")
    audiences = [r["audience_key"] for r in ctx.query(
        "SELECT audience_key FROM articulate.session_audiences WHERE session_id = %s ORDER BY audience_key", [ctx.config.session_id]
    )]
    judge_count = len({c["judge_id"] for cat in result["feedback"]["categories"] for c in cat["judges"]["by_judge"]})

    write_delta(ctx, session, result, audiences, judge_count)
    with ctx.db() as conn:
        conn.execute(
            """INSERT INTO articulate.feedback_results (session_id, feedback_json, model_name, prompt_version, depth_level)
               VALUES (%s, %s, %s, %s, %s)""",
            [ctx.config.session_id, Jsonb(result["feedback"]), result["model_name"], result["prompt_version"], result["depth_level"]],
        )
        conn.execute(
            """UPDATE articulate.sessions SET status = 'complete', current_step = 'persist', status_detail = %s, updated_at = %s
                WHERE session_id = %s""",
            [_status_detail(result), datetime.now(timezone.utc), ctx.config.session_id],
        )
