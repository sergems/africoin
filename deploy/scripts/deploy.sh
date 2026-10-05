#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMPOSE_FILE="$ROOT_DIR/deploy/docker-compose.yml"
ENV_FILE="${ENV_FILE:-$ROOT_DIR/.env}"

cd "$ROOT_DIR"

command -v docker >/dev/null || { echo "Docker is required." >&2; exit 1; }
docker compose version >/dev/null || { echo "Docker Compose is required." >&2; exit 1; }
[[ -f "$ENV_FILE" ]] || { echo "Missing $ENV_FILE. Copy deploy/env.example to .env and fill it in." >&2; exit 1; }

if [[ "${SKIP_GIT_PULL:-0}" != "1" && -d .git ]]; then
  git pull --ff-only
fi

docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" config -q
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" build app migrate
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d db
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" --profile tools run --rm migrate
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d app

APP_PORT="$(grep -E '^APP_PORT=' "$ENV_FILE" | tail -n 1 | cut -d= -f2- || true)"
APP_PORT="${APP_PORT:-3000}"
for attempt in {1..30}; do
  if curl --fail --silent "http://127.0.0.1:${APP_PORT}/api/health" >/dev/null; then
    echo "Africoin is healthy on 127.0.0.1:${APP_PORT}."
    docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" ps
    exit 0
  fi
  sleep 2
done

echo "Application did not become healthy. Recent app logs:" >&2
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" logs --tail=100 app >&2
exit 1

