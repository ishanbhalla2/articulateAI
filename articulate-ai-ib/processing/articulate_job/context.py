"""Shared state for one processing step: job parameters, Lakebase access and Volume paths."""
from __future__ import annotations

import json
import os
from contextlib import contextmanager
from dataclasses import dataclass
from functools import cached_property
from typing import Any, Iterator

import psycopg
from psycopg.rows import dict_row
from databricks.sdk import WorkspaceClient


@dataclass(frozen=True)
class Config:
    session_id: str
    job_run_id: str | None
    volume_root: str
    lakebase_endpoint: str
    database: str
    delta_table: str
    whisper_model: str


class StepContext:
    def __init__(self, config: Config):
        self.config = config
        self.ws = WorkspaceClient()

    @cached_property
    def _pg_params(self) -> dict[str, Any]:
        endpoint = self.ws.postgres.get_endpoint(name=self.config.lakebase_endpoint)
        return {
            "host": endpoint.status.hosts.host,
            "dbname": self.config.database,
            "user": self.ws.current_user.me().user_name,
            "sslmode": "require",
        }

    @contextmanager
    def db(self) -> Iterator[psycopg.Connection]:
        # tokens last an hour; mint one per connection so long steps (transcription) never hold a stale one
        token = self.ws.postgres.generate_database_credential(endpoint=self.config.lakebase_endpoint).token
        with psycopg.connect(**self._pg_params, password=token, row_factory=dict_row) as conn:
            yield conn

    def query(self, sql: str, params: list | tuple | None = None) -> list[dict]:
        with self.db() as conn:
            return conn.execute(sql, params).fetchall()

    def execute(self, sql: str, params: list | tuple | None = None) -> None:
        with self.db() as conn:
            conn.execute(sql, params)

    def set_status(self, status: str, step: str | None = None, detail: str | None = None) -> None:
        self.execute(
            """UPDATE articulate.sessions
                  SET status = %s, current_step = COALESCE(%s, current_step), status_detail = %s,
                      job_run_id = COALESCE(%s, job_run_id), updated_at = now()
                WHERE session_id = %s""",
            [status, step, detail, int(self.config.job_run_id) if self.config.job_run_id else None, self.config.session_id],
        )

    def session(self) -> dict:
        rows = self.query("SELECT * FROM articulate.sessions WHERE session_id = %s", [self.config.session_id])
        if not rows:
            raise ValueError(f"Session {self.config.session_id} not found")
        return rows[0]

    def media(self) -> list[dict]:
        return self.query(
            "SELECT * FROM articulate.session_media WHERE session_id = %s ORDER BY role, created_at", [self.config.session_id]
        )

    def judges(self) -> list[dict]:
        return self.query("SELECT * FROM articulate.session_judges WHERE session_id = %s ORDER BY position", [self.config.session_id])

    def volume_path(self, relative: str) -> str:
        return os.path.join(self.config.volume_root, relative)

    def session_dir(self, area: str) -> str:
        path = self.volume_path(f"{area}/{self.config.session_id}")
        os.makedirs(path, exist_ok=True)
        return path

    def write_json(self, relative: str, data: Any) -> str:
        path = self.volume_path(relative)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            # psycopg returns UUID and datetime objects
            json.dump(data, f, ensure_ascii=False, indent=1, default=str)
        return path

    def read_json(self, relative: str) -> Any:
        with open(self.volume_path(relative), encoding="utf-8") as f:
            return json.load(f)
