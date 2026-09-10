#!/usr/bin/env bash
# Daily snapshot of the readings database.
#
# VACUUM INTO is safe against a live, WAL-mode database being written to by the
# poller: it produces one consistent file with the WAL already folded in.
# Do NOT replace this with `cp readings.sqlite` — in WAL mode that silently
# omits every un-checkpointed write, and you won't notice until you need it.
set -euo pipefail

DB=${DB_PATH:-/srv/airquality/data/readings.sqlite}
DEST=${BACKUP_DIR:-/srv/airquality/data/backups}
KEEP_DAYS=${KEEP_DAYS:-14}

mkdir -p "$DEST"
OUT="$DEST/readings-$(date -u +%Y%m%dT%H%M%SZ).sqlite"

sqlite3 "$DB" "VACUUM INTO '$OUT'"
echo "backup written: $OUT ($(stat -c %s "$OUT") bytes)"

find "$DEST" -name 'readings-*.sqlite' -mtime "+$KEEP_DAYS" -delete
