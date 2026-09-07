#!/bin/bash
# Run E2E tests with auth bypassed, then restore normal dev server
#
# This script:
# 1. Kills the running dev server
# 2. Starts a temporary server WITHOUT Google OAuth (auth bypassed)
# 3. Waits for the backend to be healthy before proceeding
# 4. Runs Playwright E2E tests
# 5. Kills the temporary server
# 6. Restarts the normal dev server (with full .env including Google OAuth)
# 7. Re-seeds the dev database + imports BarCloud history
#
# Output is automatically logged to /app/e2e-results.log, and the dev server that
# cleanup restarts logs to /app/dev-server.log
# (Not inside test-results/ because Playwright clears that directory each run)
# Usage: npm run test:e2e [-- playwright args]

set -o pipefail

BACKEND_URL="http://localhost:3001"
BARCLOUD_CSV="/app/Barcloud-History.csv"
DEV_SNAPSHOT="/app/server/data/dev-snapshot.sql.gz"
LOG_FILE="/app/e2e-results.log"
DEV_SERVER_LOG="/app/dev-server.log"

# Tee all output to log file
exec > >(tee "$LOG_FILE") 2>&1

echo "E2E test run started at $(date)"
echo "Log file: $LOG_FILE"
echo ""

# Wait for backend health endpoint to respond (up to 15 seconds)
wait_for_backend() {
  echo "  Waiting for backend at $BACKEND_URL ..."
  for i in $(seq 1 15); do
    if curl -sf "$BACKEND_URL/api/health" > /dev/null 2>&1; then
      echo "  Backend is ready."
      return 0
    fi
    sleep 1
  done
  echo "  ERROR: Backend did not start within 15 seconds."
  return 1
}

# Put dev data back after the test run truncated it. Prefers the snapshot for the
# same reason dev-entrypoint.sh does: it is one file, it is fast, and it does not
# depend on the two gitignored CSVs being present. Restoring runs BEFORE the dev
# server starts, so the server's initializeDatabase() can add any table created
# since the snapshot was taken.
restore_dev_data() {
  if [ -f "$DEV_SNAPSHOT" ]; then
    echo "=== Restoring dev database from snapshot ==="
    PGPASSWORD=backbeat psql -h postgres -U backbeat -d backbeat -q \
      -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;" > /dev/null
    gunzip -c "$DEV_SNAPSHOT" | PGPASSWORD=backbeat psql -h postgres -U backbeat -d backbeat -q > /dev/null
    return
  fi

  echo "=== Re-seeding dev database ==="
  cd /app/server
  node --env-file=../.env src/db/seed.js

  # Import BarCloud history if the CSV exists
  if [ -f "$BARCLOUD_CSV" ]; then
    echo "=== Importing BarCloud history ==="
    node --env-file=../.env src/db/import-barcloud.js "$BARCLOUD_CSV"
  fi
}

cleanup() {
  echo ""
  echo "=== Stopping test server ==="
  kill $E2E_SERVER_PID 2>/dev/null || true
  sleep 1

  restore_dev_data

  echo "=== Restarting normal dev server ==="
  cd /app/server
  # Redirect this server's output away from the script's stdout. It outlives the
  # script, so if it inherits the pipe (this script tees into $LOG_FILE) the pipe
  # never closes and the caller blocks forever after the script has exited — a
  # scripted or CI invocation hangs instead of seeing the exit code.
  node --env-file=../.env src/index.js > "$DEV_SERVER_LOG" 2>&1 &
  wait_for_backend

  echo ""
  echo "=== Done (exit code: $E2E_EXIT) ==="
  echo "E2E test run finished at $(date)"
  echo "Full log saved to: $LOG_FILE"
  exit $E2E_EXIT
}

# Trap to ensure cleanup runs even if script is interrupted
trap cleanup EXIT

echo "=== Stopping dev server ==="
pkill -f "node.*src/index.js" 2>/dev/null || true
sleep 1

echo "=== Starting server with auth bypassed ==="
# The container inherits GOOGLE_* from .env via docker compose, so they must be
# unset explicitly — otherwise authMiddleware does NOT bypass and every spec
# stops at the login screen.
cd /app/server
env -u GOOGLE_CLIENT_ID -u GOOGLE_CLIENT_SECRET -u GOOGLE_CALLBACK_URL \
DATABASE_URL=postgres://backbeat:backbeat@postgres:5432/backbeat \
SESSION_SECRET=backbeat-stash-9f2k7x4m1p8q3w6 \
CORS_ORIGIN=http://localhost:5173 \
node src/index.js &
E2E_SERVER_PID=$!

if ! wait_for_backend; then
  echo "Aborting E2E tests — backend failed to start."
  E2E_EXIT=1
  exit 1
fi

echo ""
echo "=== Running Playwright E2E tests ==="
cd /app
npx playwright test "$@"
E2E_EXIT=$?
