#!/bin/bash
set -e

echo "=== Backbeat Dev Environment Setup ==="

# Configure git for GitHub access if token is provided
if [ -n "$GITHUB_TOKEN" ]; then
  echo "Configuring GitHub access..."
  git config --global credential.helper store
  echo "https://x-access-token:${GITHUB_TOKEN}@github.com" > ~/.git-credentials
  gh auth setup-git
fi

# Set git identity if provided
if [ -n "$GIT_USER_NAME" ]; then
  git config --global user.name "$GIT_USER_NAME"
fi
if [ -n "$GIT_USER_EMAIL" ]; then
  git config --global user.email "$GIT_USER_EMAIL"
fi

# Install dependencies (fast no-op when node_modules already exists)
echo "Checking server dependencies..."
cd /app/server && npm install

echo "Checking client dependencies..."
cd /app/client && npm install

# Seed database only if tables don't exist yet
cd /app/server
NEEDS_SEED=$(node -e "
  import pool from './src/db/connection.js';
  const {rows} = await pool.query(\"SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public'\");
  await pool.end();
  process.exit(rows[0].count > 0 ? 0 : 1);
" 2>/dev/null && echo "no" || echo "yes")

if [ "$NEEDS_SEED" = "yes" ]; then
  if [ -f /app/server/data/dev-snapshot.sql.gz ]; then
    echo "Restoring database from snapshot..."
    gunzip -c /app/server/data/dev-snapshot.sql.gz | PGPASSWORD=backbeat psql -h postgres -U backbeat backbeat > /dev/null
  else
    echo "Seeding database..."
    node src/db/seed.js
    if [ -f /app/Barcloud-History.csv ]; then
      echo "Importing BarCloud data..."
      node src/db/import-barcloud.js /app/Barcloud-History.csv
    fi
  fi
else
  echo "Database already seeded, skipping."
fi

# Start dev servers in background
echo "Starting dev servers..."
cd /app
npm run dev &

echo "=== Setup complete! Dev servers starting in background. ==="

# Drop into interactive bash
exec bash
