# Docker Sandbox - Backbeat Development Environment

A containerized development environment for Backbeat/Stash. Includes Node.js, GitHub CLI, and Claude Code pre-installed. The container isolates your development work so Claude Code can't affect anything outside the project.

## Prerequisites

- **Docker Desktop** — Download from https://www.docker.com/products/docker-desktop/
- **Claude Max subscription** — For AI-assisted development (sign up at https://claude.ai)
- **GitHub Personal Access Token** — For pushing branches and creating PRs (see Getting Started)

---

## First-Time Setup (do once)

### 1. Create your `.env` file

```bash
cp .env.example .env
```

Edit `.env` and fill in:

```
GITHUB_TOKEN=ghp_your-token-here
GIT_USER_NAME=Your Name
GIT_USER_EMAIL=your-email@example.com
```

All three matter: `GITHUB_TOKEN` lets you push branches, and `GIT_USER_NAME` /
`GIT_USER_EMAIL` set the git identity. Without the name and email, `git commit`
inside the container fails with "Please tell me who you are."
`./scripts/dev.sh` warns you on startup if either one is missing.

### 2. Build and start

```bash
docker compose build
docker compose up
```

The container automatically:
1. Installs all npm dependencies
2. Seeds the database (first run only)
3. Starts the dev servers (Express API + Vite frontend)

Open http://localhost:5173 in your browser.

---

## Every Time You Work

```bash
./scripts/dev.sh
```

One command, one terminal. The script starts Docker Desktop if it isn't running,
brings the containers up, waits until the API is actually responding (dependency
installs and seeding are finished), and then opens Claude Code inside the container.

Open http://localhost:5173 in your browser.

Log in with your Claude Max account when prompted (first time only).

### Script options

| Command | What it does |
|---|---|
| `./scripts/dev.sh` | Start everything, then open Claude Code |
| `./scripts/dev.sh --no-claude` | Start the stack only, no Claude session |
| `./scripts/dev.sh --shell` | Open a plain bash shell instead of Claude |
| `./scripts/dev.sh --rebuild` | Rebuild the image first (after Dockerfile changes) |
| `./scripts/dev.sh --help` | Show usage |

### When you're done

Exiting Claude leaves the app running. To stop the containers:

```bash
docker compose stop
```

Your code and database are preserved — nothing is lost.

### Doing it manually

The script is a convenience wrapper. The equivalent by hand, in two terminals:

```bash
# Terminal 1
docker compose up

# Terminal 2, once setup is complete
docker compose exec -w /app backbeat bash
claude
```

---

## After Dockerfile Changes (rebuild)

If the Dockerfile is modified (e.g., new tools added, Node version updated):

```bash
./scripts/dev.sh --rebuild
```

Or by hand:

```bash
docker compose build
docker compose up
```

Dependencies are reinstalled automatically on startup.

---

## What's Inside the Container

| Tool | Version | Purpose |
|---|---|---|
| Node.js | 20 LTS | Runtime for Express + Vite |
| npm | (bundled) | Package manager |
| git | (system) | Version control |
| gh | (system) | GitHub CLI for PRs and branches |
| Claude Code | latest | AI-assisted development |

## Volume Strategy

| Path | Type | Persists? | Notes |
|---|---|---|---|
| `/app` | Bind mount | Yes (on host) | Project source code |
| `/app/server/node_modules` | Named volume | Yes (in Docker) | Survives container restarts |
| `/app/client/node_modules` | Named volume | Yes (in Docker) | Survives container restarts |
| `pgdata` | Named volume | Yes (in Docker) | PostgreSQL database |

## Common Commands

All commands run inside the container (use `./scripts/dev.sh --shell`, or
`docker compose exec -w /app backbeat bash`, to get a shell):

```bash
claude                         # Start Claude Code
cd /app/server && npm test     # Run the test suite
cd /app/server && npm run seed # Reset the database
```

## Nuclear Option (full reset)

If something goes wrong and you want to start completely fresh:

```bash
docker compose down -v
docker compose build
docker compose up
```

The `-v` flag removes all Docker volumes (node_modules and database). Everything will be reinstalled and reseeded automatically on the next startup. Your source code is safe — it lives on the host.

## Security Model

- The container only has access to the project directory (bind-mounted at `/app`)
- Claude Code can modify project files but nothing else on your machine
- Branch protection on GitHub prevents merging to main without approval
- If something goes wrong, `docker compose down -v` wipes the container and volumes
- Your source code is always on the host — the container can't delete it without you noticing via `git status`
