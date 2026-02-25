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
# Output is automatically logged to /app/e2e-results.log
# (Not inside test-results/ because Playwright clears that directory each run)
# Usage: npm run test:e2e [-- playwright args]

set -o pipefail

BACKEND_URL="http://localhost:3001"
BARCLOUD_CSV="/app/Barcloud-History.csv"
LOG_FILE="/app/e2e-results.log"

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

cleanup() {
  echo ""
  echo "=== Stopping test server ==="
  kill $E2E_SERVER_PID 2>/dev/null || true
  sleep 1

  echo "=== Restarting normal dev server ==="
  cd /app/server
  node --env-file=../.env src/index.js &
  wait_for_backend

  echo "=== Re-seeding dev database ==="
  cd /app/server
  node --env-file=../.env src/db/seed.js

  # Import BarCloud history if the CSV exists
  if [ -f "$BARCLOUD_CSV" ]; then
    echo "=== Importing BarCloud history ==="
    node --env-file=../.env src/db/import-barcloud.js "$BARCLOUD_CSV"
  fi

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
cd /app/server
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
