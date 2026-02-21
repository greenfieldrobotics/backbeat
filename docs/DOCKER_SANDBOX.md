# Docker Sandbox - Backbeat Development Environment

A containerized development environment for Backbeat/Stash. Includes Node.js, all build tools, and Claude CLI pre-installed. The container isolates your development work so Claude CLI in YOLO mode can't affect anything outside the project.

## Prerequisites

- **Docker Desktop** — Download from https://www.docker.com/products/docker-desktop/
- **Anthropic API key** — Get one at https://console.anthropic.com/settings/keys

---

## First-Time Setup (do once)

### 1. Create your `.env` file

```bash
cp .env.example .env
```

Edit `.env` and paste your API key:

```
ANTHROPIC_API_KEY=sk-ant-...
```

### 2. Build the Docker image

```bash
docker compose build
```

This installs Node 20, git, native build tools, and Claude CLI into the image. Takes a few minutes.

### 3. Start the container and install dependencies

```bash
docker compose run --service-ports backbeat
```

Inside the container:

```bash
cd /app/server && npm install
cd /app/client && npm install
```

The `node_modules` directories are stored in Docker volumes, so they persist between sessions.

That's it for first-time setup. You're now inside the container and ready to work (see "Every Time" below).

---

## After Dockerfile Changes (rebuild)

If the Dockerfile is modified (e.g., new tools added, Node version updated), you need to rebuild the image:

```bash
docker compose build
```

If `package.json` dependencies changed, you'll also need to re-run `npm install` inside the container.

---

## Every Time You Work

### Start the container

```bash
docker compose run --service-ports backbeat
```

This gives you a bash shell. Then start the dev servers:

```bash
npm run dev
```

Open http://localhost:5173 in your browser.

### Run Claude CLI (in a second terminal)

```bash
docker compose exec backbeat bash
```

Then:

```bash
cd /app
claude
```

### When you're done

Type `exit` to leave the container. The container stops automatically. Your code and database are on the host filesystem — nothing is lost.

---

## What's Inside the Container

| Tool | Version | Purpose |
|---|---|---|
| Node.js | 20 LTS | Runtime for Express + Vite |
| npm | (bundled) | Package manager |
| git | (system) | Version control |
| python3, make, g++ | (system) | Native module compilation (better-sqlite3) |
| Claude CLI | latest | AI-assisted development |

## Volume Strategy

| Path | Type | Persists? | Notes |
|---|---|---|---|
| `/app` | Bind mount | Yes (on host) | Project source code + SQLite database |
| `/app/server/node_modules` | Named volume | Yes (in Docker) | Survives container restarts |
| `/app/client/node_modules` | Named volume | Yes (in Docker) | Survives container restarts |

## Common Commands

All commands run inside the container:

```bash
npm run dev                    # Start both dev servers
npm run seed                   # Seed/reset the database
claude                         # Start Claude CLI
node --version                 # Check Node version
```

## Nuclear Option (full reset)

If something goes wrong and you want to start completely fresh:

```bash
docker compose down -v
docker compose build
docker compose run --service-ports backbeat
# Then re-run npm install inside the container
```

The `-v` flag removes the named volumes (node_modules), so you'll need to `npm install` again. Your source code and database are safe — they live on the host.

## Security Model

- The container only has access to the project directory (bind-mounted at `/app`)
- Claude CLI in YOLO mode can modify project files but nothing else on your machine
- If something goes wrong, `docker compose down -v` wipes the container and volumes
- Your source code is always on the host — the container can't delete it without you noticing via `git status`
