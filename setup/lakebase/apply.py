"""Apply the Lakebase SQL files in order: python apply.py --profile vivanti [files...]"""
import argparse
import json
import pathlib
import subprocess

import psycopg

PROJECT = "articulate-ai-ib"
BRANCH = "production"
ENDPOINT = f"projects/{PROJECT}/branches/{BRANCH}/endpoints/primary"
DATABASE = "databricks_postgres"


def cli(profile: str, *args: str) -> dict:
    out = subprocess.run(["databricks", *args, "--profile", profile, "-o", "json"], check=True, capture_output=True, text=True)
    return json.loads(out.stdout)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--profile", required=True)
    parser.add_argument("files", nargs="*")
    args = parser.parse_args()

    here = pathlib.Path(__file__).parent
    files = [pathlib.Path(f) for f in args.files] or sorted(here.glob("[0-9][0-9][0-9]_*.sql"))

    host = cli(args.profile, "postgres", "get-endpoint", ENDPOINT)["status"]["hosts"]["host"]
    token = cli(args.profile, "postgres", "generate-database-credential", ENDPOINT)["token"]
    user = cli(args.profile, "current-user", "me")["userName"]

    with psycopg.connect(host=host, dbname=DATABASE, user=user, password=token, sslmode="require") as conn:
        for f in files:
            conn.execute(f.read_text())
            print(f"applied {f.name}")


if __name__ == "__main__":
    main()
