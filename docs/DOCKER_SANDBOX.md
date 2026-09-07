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
| `./scripts/dev.sh` | Start everything, then open Claude Code (Sonnet) with no permission prompts |
| `./scripts/dev.sh --model opus` | Run the container session on a different model |
| `./scripts/dev.sh --safe` | Same, but with normal permission prompts |
| `./scripts/dev.sh --no-claude` | Start the stack only, no Claude session |
| `./scripts/dev.sh --shell` | Open a plain bash shell instead of Claude |
| `./scripts/dev.sh --rebuild` | Rebuild the image first (after Dockerfile changes) |
| `./scripts/dev.sh --help` | Show usage |

### No permission prompts ("yolo mode")

By default the script starts Claude with `--dangerously-skip-permissions`, so it
edits files, runs commands and installs packages inside the container without
stopping to ask. That is the point of the sandbox.

Two details make this work, and they are easy to trip over if you launch Claude
by hand instead of via the script:

- The container runs as **root**, and Claude refuses `--dangerously-skip-permissions`
  as root unless `IS_SANDBOX=1` is also set. Without it you get:
  `--dangerously-skip-permissions cannot be used with root/sudo privileges`.
- The full command is therefore:

```bash
docker compose exec -w /app -e IS_SANDBOX=1 backbeat claude --dangerously-skip-permissions
```

Use `./scripts/dev.sh --safe` when you would rather approve each action.

### Which model the container session runs

The script starts Claude on **Sonnet**. The intended division of labour is that
plans are made in Opus outside the container and carried out by the container
session, so the executing model does not need to be the expensive one. Override
per-run with `--model` (`--model opus`, `--model haiku`, or a full model name).

Launching by hand, the model flag goes alongside the sandbox flags:

```bash
docker compose exec -w /app -e IS_SANDBOX=1 backbeat \
  claude --model sonnet --dangerously-skip-permissions
```

**What this does and does not contain.** Prompt-free Claude cannot touch anything
on your Mac outside the project — no home directory, no SSH keys, no other repos.
But `/app` is a live bind mount of the real project folder, so file edits and git
history are your actual files, and `GITHUB_TOKEN` from `.env` is present in the
container, so pushes to GitHub are possible. Commit often, and keep work on a
branch.

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
docker compose exec -w /app -e IS_SANDBOX=1 backbeat bash
claude --dangerously-skip-permissions
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
claude --dangerously-skip-permissions   # Start Claude Code with no prompts
claude                         # Start Claude Code
cd /app/server && npm test     # Run the test suite
cd /app/server && npm run seed # Reset the database
```

## Troubleshooting

### The app never comes up, and `docker compose logs -f backbeat` shows nothing

The image is stale — it was built before `dev-entrypoint.sh` existed, so the
container starts a bare `bash` and does nothing: no dependency install, no
seeding, no dev servers, and therefore no log output at all.

```bash
./scripts/dev.sh --rebuild
```

`./scripts/dev.sh` detects this and tells you within a couple of seconds rather
than waiting for the health check to time out.

Rebuild any time `Dockerfile.dev` or `dev-entrypoint.sh` changes — a new image
does not replace an already-running container on its own, which is why
`--rebuild` also passes `--force-recreate`.

---

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
