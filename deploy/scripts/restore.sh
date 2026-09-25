#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMPOSE_FILE="$ROOT_DIR/deploy/docker-compose.yml"
ENV_FILE="${ENV_FILE:-$ROOT_DIR/.env}"
BACKUP_FILE="${1:-}"

[[ -n "$BACKUP_FILE" && -f "$BACKUP_FILE" ]] || { echo "Usage: $0 /path/to/africoin-backup.sql.gz" >&2; exit 1; }
[[ "${CONFIRM_RESTORE:-}" == "YES" ]] || { echo "This replaces database contents. Re-run with CONFIRM_RESTORE=YES." >&2; exit 1; }

set -a
source "$ENV_FILE"
set +a

gunzip -c "$BACKUP_FILE" | docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T db \
  sh -c 'exec mysql -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE"'

echo "Restore completed from $BACKUP_FILE"

