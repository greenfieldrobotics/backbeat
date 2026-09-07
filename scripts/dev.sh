#!/bin/bash
# Start the Backbeat dev sandbox and drop into Claude Code inside the container
#
# This script (runs on your Mac, not in the container):
# 1. Starts Docker Desktop if it isn't already running, and waits for it
# 2. Starts the containers in the background (docker compose up -d)
# 3. Waits for the API health endpoint, so seeding/installs are finished
# 4. Opens an interactive Claude Code session inside the container
#
# Claude runs with permission prompts disabled ("yolo mode"), which is the point
# of the container: it can edit, run and install freely inside /app without
# stopping to ask. Pass --safe to get normal permission prompts instead.
#
# It runs on Sonnet by default. The division of labour is that plans are made in
# Opus outside the container and executed by this session, so the executing model
# does not need to be the expensive one. Override with --model.
#
# Usage:
#   ./scripts/dev.sh                 # start everything, then run Claude (Sonnet, no prompts)
#   ./scripts/dev.sh --model opus    # run Claude on a different model
#   ./scripts/dev.sh --safe          # same, but with normal permission prompts
#   ./scripts/dev.sh --no-claude     # just start the stack, no Claude session
#   ./scripts/dev.sh --rebuild       # rebuild the image first (after Dockerfile changes)
#   ./scripts/dev.sh --shell         # open a plain bash shell instead of Claude
#
# The containers keep running after you exit Claude. Stop them with:
#   docker compose stop

set -o pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT" || exit 1

BACKEND_URL="http://localhost:3001"
APP_URL="http://localhost:5173"
DOCKER_WAIT_SECONDS=90
APP_WAIT_SECONDS=600   # First run installs npm deps and seeds the DB — this can be slow

RUN_CLAUDE=yes
OPEN_SHELL=no
REBUILD=no
YOLO=yes
CLAUDE_MODEL=sonnet   # Plans are made in Opus outside the container; this session executes

while [ $# -gt 0 ]; do
  case "$1" in
    --no-claude) RUN_CLAUDE=no ;;
    --shell)     OPEN_SHELL=yes ;;
    --rebuild)   REBUILD=yes ;;
    --safe)      YOLO=no ;;
    --model)
      shift
      if [ -z "$1" ]; then
        echo "ERROR: --model needs a value (e.g. --model opus)"
        exit 1
      fi
      CLAUDE_MODEL="$1"
      ;;
    --model=*)   CLAUDE_MODEL="${1#--model=}" ;;
    -h|--help)   awk 'NR>1 && /^#/ {sub(/^# ?/, ""); print; next} NR>1 {exit}' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "Unknown option: $1 (try --help)"; exit 1 ;;
  esac
  shift
done

if [ -z "$CLAUDE_MODEL" ]; then
  echo "ERROR: --model was given an empty value"
  exit 1
fi

# --- Sanity checks ------------------------------------------------------------

if ! command -v docker > /dev/null 2>&1; then
  echo "ERROR: docker command not found."
  echo "Install Docker Desktop: https://www.docker.com/products/docker-desktop/"
  exit 1
fi

if [ ! -f "$REPO_ROOT/.env" ]; then
  echo "ERROR: No .env file found at $REPO_ROOT/.env"
  echo "Create one with:  cp .env.example .env   (then fill in your values)"
  exit 1
fi

# Warn about a missing git identity — commits inside the container fail without it
for var in GIT_USER_NAME GIT_USER_EMAIL; do
  if ! grep -qE "^${var}=.+" "$REPO_ROOT/.env"; then
    echo "WARNING: $var is not set in .env — 'git commit' inside the container will fail."
    echo "         Add it to .env and restart with: docker compose up -d --force-recreate"
    echo ""
  fi
done

# --- Helpers -----------------------------------------------------------------

# Confirm the running container was built from a current image.
# Returns 1 (and explains) when the image is stale.
check_image_is_current() {
  local cid image_cmd
  cid="$(docker compose ps -q backbeat 2>/dev/null)"
  if [ -z "$cid" ]; then
    return 0   # Nothing running to check
  fi

  if docker exec "$cid" test -f /usr/local/bin/dev-entrypoint.sh > /dev/null 2>&1; then
    return 0
  fi

  image_cmd="$(docker inspect "$cid" --format '{{join .Config.Cmd " "}}' 2>/dev/null)"

  echo ""
  echo "ERROR: The container is running a stale image."
  echo "  /usr/local/bin/dev-entrypoint.sh is missing from it, so startup does nothing:"
  echo "  no dependency install, no database seeding, no dev servers, and no log output."
  echo "  The container just idles on '${image_cmd:-bash}' forever."
  echo ""
  echo "  This happens when the image was built before dev-entrypoint.sh was added"
  echo "  to Dockerfile.dev. Rebuild it:"
  echo ""
  echo "      ./scripts/dev.sh --rebuild"
  echo ""
  return 1
}

# Has this sandbox been set up before? Used only to pick an honest wait message.
# Assumes "no" when it cannot tell, so the slow-path warning is never skipped wrongly.
sandbox_is_provisioned() {
  local count
  count="$(docker compose exec -T backbeat sh -c 'ls /app/server/node_modules 2>/dev/null | wc -l' 2>/dev/null | tr -cd '0-9')"
  case "$count" in
    '') return 1 ;;
    *)  [ "$count" -gt 10 ] ;;
  esac
}

# --- Start Docker Desktop ----------------------------------------------------

if docker info > /dev/null 2>&1; then
  echo "=== Docker is already running ==="
else
  echo "=== Starting Docker Desktop ==="
  if ! open -a Docker > /dev/null 2>&1; then
    echo "ERROR: Could not launch Docker Desktop. Start it manually, then re-run this script."
    exit 1
  fi

  echo -n "  Waiting for the Docker daemon "
  for _ in $(seq 1 "$DOCKER_WAIT_SECONDS"); do
    if docker info > /dev/null 2>&1; then
      break
    fi
    echo -n "."
    sleep 1
  done
  echo ""

  if ! docker info > /dev/null 2>&1; then
    echo "ERROR: Docker did not become ready within ${DOCKER_WAIT_SECONDS}s."
    echo "Check the Docker Desktop window for errors, then re-run this script."
    exit 1
  fi
  echo "  Docker is ready."
fi

# --- Build (optional) and start the containers -------------------------------

if [ "$REBUILD" = "yes" ]; then
  echo ""
  echo "=== Rebuilding the dev image ==="
  if ! docker compose build; then
    echo "ERROR: docker compose build failed."
    exit 1
  fi
fi

echo ""
if [ "$REBUILD" = "yes" ]; then
  # A new image alone does not replace an already-running container, so force it
  ALREADY_UP=no
  echo "=== Recreating containers on the new image ==="
  if ! docker compose up -d --force-recreate; then
    echo "ERROR: docker compose up failed."
    exit 1
  fi
elif curl -sf "$BACKEND_URL/api/health" > /dev/null 2>&1; then
  echo "=== Stack is already up ==="
  ALREADY_UP=yes
else
  ALREADY_UP=no
  echo "=== Starting containers ==="
  if ! docker compose up -d; then
    echo "ERROR: docker compose up failed."
    exit 1
  fi
fi

# The image must carry dev-entrypoint.sh. An image built before that was added to
# Dockerfile.dev starts a bare `bash` instead: nothing installs, nothing seeds, no
# dev servers, no log output, and the health check below would never pass.
if ! check_image_is_current; then
  exit 1
fi

# --- Wait for the app to be ready --------------------------------------------

if [ "$ALREADY_UP" = "no" ]; then
  echo ""
  echo "=== Waiting for the app to come up ==="
  if sandbox_is_provisioned; then
    echo "  (Dependencies and database are already in place — this should be quick.)"
  else
    echo "  (First run: installing dependencies and seeding the database — a few minutes.)"
  fi
  echo "  Follow along in another terminal with:  docker compose logs -f backbeat"
  echo -n "  "

  READY=no
  for i in $(seq 1 "$APP_WAIT_SECONDS"); do
    if curl -sf "$BACKEND_URL/api/health" > /dev/null 2>&1; then
      READY=yes
      break
    fi

    # Bail out early if the container died instead of waiting the full timeout
    if [ "$(docker compose ps -q backbeat 2>/dev/null)" = "" ]; then
      echo ""
      echo "ERROR: The backbeat container is not running. Recent logs:"
      docker compose logs --tail 40 backbeat
      exit 1
    fi

    # A dot every 5 seconds keeps the output readable
    if [ $((i % 5)) -eq 0 ]; then
      echo -n "."
    fi
    sleep 1
  done
  echo ""

  if [ "$READY" = "no" ]; then
    echo "ERROR: The API did not respond within ${APP_WAIT_SECONDS}s. Recent logs:"
    docker compose logs --tail 40 backbeat
    exit 1
  fi
  echo "  App is ready."
fi

echo ""
echo "=== Backbeat is running ==="
echo "  App:  $APP_URL"
echo "  API:  $BACKEND_URL/api/health"

# --- Drop into the container --------------------------------------------------

# Claude refuses --dangerously-skip-permissions while running as root unless
# IS_SANDBOX=1 is set, and this container runs as root. Setting both is what
# makes prompt-free ("yolo") mode work here.
CLAUDE_ENV=(-e IS_SANDBOX=1)
CLAUDE_ARGS=(--model "$CLAUDE_MODEL")
if [ "$YOLO" = "yes" ]; then
  CLAUDE_ARGS+=(--dangerously-skip-permissions)
fi

# The exact command, for the hints printed below
claude_hint() {
  if [ "$YOLO" = "yes" ]; then
    echo "docker compose exec -w /app -e IS_SANDBOX=1 backbeat claude --model $CLAUDE_MODEL --dangerously-skip-permissions"
  else
    echo "docker compose exec -w /app backbeat claude --model $CLAUDE_MODEL"
  fi
}

if [ "$OPEN_SHELL" = "yes" ]; then
  echo ""
  echo "=== Opening a shell in the container (type 'exit' to leave) ==="
  echo "  Start Claude without prompts:  claude --model $CLAUDE_MODEL --dangerously-skip-permissions"
  exec docker compose exec -w /app "${CLAUDE_ENV[@]}" backbeat bash
fi

if [ "$RUN_CLAUDE" = "no" ]; then
  echo ""
  echo "Containers are running in the background."
  echo "  Claude session:  $(claude_hint)"
  echo "  Stop the stack:  docker compose stop"
  exit 0
fi

echo ""
if [ "$YOLO" = "yes" ]; then
  echo "=== Starting Claude Code inside the container ($CLAUDE_MODEL, permission prompts off) ==="
  echo "  Claude will edit, run and install inside the container without asking."
  echo "  Note that /app is your real project folder on this Mac, so file changes"
  echo "  and git history are live. Use --safe if you want prompts back."
else
  echo "=== Starting Claude Code inside the container ($CLAUDE_MODEL, normal prompts) ==="
fi
echo "  (Log in with your Claude account if prompted. Exiting Claude leaves the app running.)"
echo ""
docker compose exec -w /app "${CLAUDE_ENV[@]}" backbeat claude "${CLAUDE_ARGS[@]}"
CLAUDE_EXIT=$?

echo ""
echo "=== Claude session ended — Backbeat is still running at $APP_URL ==="
echo "  Reopen Claude:   $(claude_hint)"
echo "  Stop the stack:  docker compose stop"
exit $CLAUDE_EXIT
