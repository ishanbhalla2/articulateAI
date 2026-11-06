"""Grant a deployed app's service principal access to the articulate schema: python grant_app.py --profile vivanti --app articulate-ai-ib"""
import argparse

import psycopg
from psycopg import sql

from apply import DATABASE, ENDPOINT, cli


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--profile", required=True)
    parser.add_argument("--app", required=True)
    args = parser.parse_args()

    role = cli(args.profile, "apps", "get", args.app)["service_principal_client_id"]
    host = cli(args.profile, "postgres", "get-endpoint", ENDPOINT)["status"]["hosts"]["host"]
    token = cli(args.profile, "postgres", "generate-database-credential", ENDPOINT)["token"]
    user = cli(args.profile, "current-user", "me")["userName"]

    with psycopg.connect(host=host, dbname=DATABASE, user=user, password=token, sslmode="require") as conn:
        if not conn.execute("SELECT 1 FROM pg_roles WHERE rolname = %s", [role]).fetchone():
            raise SystemExit(f"Postgres role {role} does not exist yet; deploy the app with its postgres resource first.")
        r = sql.Identifier(role)
        for stmt in [
            "GRANT USAGE ON SCHEMA articulate TO {r}",
            "GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA articulate TO {r}",
            "GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA articulate TO {r}",
            # tables added by later migrations (run as the owner) pick these up automatically
            "ALTER DEFAULT PRIVILEGES IN SCHEMA articulate GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO {r}",
            "ALTER DEFAULT PRIVILEGES IN SCHEMA articulate GRANT USAGE, SELECT ON SEQUENCES TO {r}",
        ]:
            conn.execute(sql.SQL(stmt).format(r=r))
        print(f"granted articulate schema access to {role} ({args.app})")


if __name__ == "__main__":
    main()
