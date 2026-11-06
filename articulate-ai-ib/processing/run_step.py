"""Entry point for each task of the process-session job: python run_step.py --step <name> --session_id <uuid> ..."""
import argparse
import os
import sys
import time

# Serverless runs this file via exec(), so __file__ is undefined; argv[0] holds the script path instead.
_script = globals().get("__file__") or sys.argv[0]
sys.path.insert(0, os.path.dirname(os.path.abspath(_script)) if _script else os.getcwd())

from articulate_job import classify, feedback, media, metrics, persist, transcribe  # noqa: E402
from articulate_job.context import Config, StepContext  # noqa: E402

STEPS = {
    "prepare_media": media.run,
    "transcribe": transcribe.run,
    "delivery_metrics": metrics.run,
    "classify_domain": classify.run,
    "generate_feedback": feedback.run,
    "persist": persist.run,
}


def mark_failed(ctx: StepContext) -> None:
    session = ctx.session()
    if session["status"] != "failed":
        ctx.set_status("failed", detail=f"Processing stopped during {session['current_step'] or 'start-up'}. Check the job run for details.")


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--step", required=True, choices=[*STEPS, "mark_failed"])
    p.add_argument("--session_id", required=True)
    p.add_argument("--job_run_id", default=None)
    p.add_argument("--volume_root", required=True)
    p.add_argument("--lakebase_endpoint", required=True)
    p.add_argument("--database", required=True)
    p.add_argument("--delta_table", required=True)
    p.add_argument("--whisper_model", default="small")
    a = p.parse_args()
    # The app's jobs plugin also exposes a parameterless HTTP trigger; such runs have no session and must do nothing.
    if not a.session_id:
        print("[articulate] no session_id given; nothing to do")
        return

    ctx = StepContext(Config(a.session_id, a.job_run_id, a.volume_root, a.lakebase_endpoint, a.database, a.delta_table, a.whisper_model))
    if a.step == "mark_failed":
        mark_failed(ctx)
        return
    session = ctx.session()
    if session["status"] not in ("uploaded", "processing"):
        print(f"[articulate] session is '{session['status']}', not queued for processing; skipping {a.step}")
        return
    if session["job_run_id"] and a.job_run_id and str(session["job_run_id"]) != a.job_run_id:
        print(f"[articulate] session now belongs to run {session['job_run_id']}; this run stops at {a.step}")
        return

    started = time.time()
    ctx.set_status("processing", step=a.step)
    try:
        STEPS[a.step](ctx)
    except Exception as err:
        ctx.set_status("failed", step=a.step, detail=f"Failed while {a.step.replace('_', ' ')}: {str(err)[:400]}")
        raise
    print(f"[articulate] {a.step} finished in {time.time() - started:.1f}s")


if __name__ == "__main__":
    main()
