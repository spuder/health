#!/bin/sh
set -e

DATA_DIR="${DATA_DIR:-/data}"

echo "Health Dashboard starting..."
echo "Data directory: $DATA_DIR"

# ── First-run: seed the data volume ──────────────────────────
# The volume starts empty. Copy default files (users.json, seed
# body/blood/events JSON) into it so the migration has something
# to work with. Uses -n (no-clobber) so subsequent starts never
# overwrite data the user has already written.
if [ ! -f "$DATA_DIR/users.json" ]; then
  echo "First run: initialising data directory..."
  cp -rn /app/data-defaults/. "$DATA_DIR/"
fi

# ── Migration: JSON → SQLite ─────────────────────────────────
# Idempotent (uses INSERT OR IGNORE). Safe to run every start —
# existing rows are never overwritten, only new ones added.
echo "Running migration (idempotent)..."
node scripts/migrate.js

# ── Start server ─────────────────────────────────────────────
exec node server.js
