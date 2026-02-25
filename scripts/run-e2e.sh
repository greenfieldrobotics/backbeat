#!/bin/bash
# Run E2E tests with auth bypassed, then restore normal dev server
#
# This script:
# 1. Kills the running dev server
# 2. Starts a temporary server WITHOUT Google OAuth (auth bypassed)
# 3. Runs Playwright E2E tests
# 4. Kills the temporary server
# 5. Restarts the normal dev server (with full .env including Google OAuth)
# 6. Re-seeds the dev database (E2E global-setup truncates tables)

cleanup() {
  echo "=== Stopping test server ==="
  kill $E2E_SERVER_PID 2>/dev/null || true
  sleep 1

  echo "=== Restarting normal dev server ==="
  cd /app/server
  node --env-file=../.env src/index.js &
  sleep 2

  echo "=== Re-seeding dev database ==="
  cd /app/server
  node --env-file=../.env src/db/seed.js

  echo "=== Done (exit code: $E2E_EXIT) ==="
  exit $E2E_EXIT
}

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
sleep 2

echo "=== Running Playwright E2E tests ==="
cd /app
npx playwright test
E2E_EXIT=$?

cleanup
