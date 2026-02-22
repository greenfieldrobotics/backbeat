# Getting Started - Backbeat / Stash MVP

## Prerequisites

- **Docker Desktop** — Download from https://www.docker.com/products/docker-desktop/
- **Claude Max subscription** — Sign up at https://claude.ai (for AI-assisted development)
- **GitHub account** — With access to the greenfieldrobotics/backbeat repo

---

## First-Time Setup (do once)

### 1. Clone the repo

```bash
git clone https://github.com/greenfieldrobotics/backbeat.git
cd backbeat
```

### 2. Create your `.env` file

```bash
cp .env.example .env
```

Edit `.env` and fill in:

```
GITHUB_TOKEN=ghp_your-token-here
GIT_USER_NAME=Your Name
GIT_USER_EMAIL=your-email@example.com
```

To get a GitHub token:
1. Go to https://github.com/settings/tokens
2. Click **Generate new token (classic)**
3. Name it "Backbeat sandbox", select the `repo` scope
4. Copy the token and paste it into `.env`

### 3. Build and start

```bash
docker compose build
docker compose up
```

The first time takes a few minutes. The container will automatically:
- Install all dependencies
- Seed the database with sample data
- Start the dev servers

### 4. Open the app

Go to http://localhost:5173 in your browser.

### 5. Start Claude Code (in a second terminal)

```bash
docker compose exec backbeat bash
claude
```

Log in with your Claude Max account when prompted.

---

## Every Time You Work

```bash
docker compose up
```

That's it. Open http://localhost:5173. Everything starts automatically.

To use Claude Code, open a second terminal:

```bash
docker compose exec backbeat bash
claude
```

When you're done, press `Ctrl+C` in the first terminal to stop the container.

---

## What You Can Do

### Inventory Overview (home page)
- See total items, total value, parts in stock, and active locations

### Parts Catalog
- Add, edit, and delete parts
- Each part has: part number, description, unit of measure, classification

### Locations
- Manage stocking locations (Warehouse, Regional Site, Contract Manufacturer)

### Purchase Orders
- Create POs with supplier, delivery date, and line items
- Move POs through the workflow: Draft → Ordered → Receive → Closed
- Receiving creates FIFO cost layers automatically

### Issue Parts
- Select a part and location, enter quantity and reason
- System consumes oldest FIFO layers first
- Shows exactly which layers were consumed and at what cost

### FIFO Valuation Report
- Summary by part and location
- Full layer detail (original qty, remaining qty, unit cost, total value, receipt date)
- Export to CSV

### Audit Trail
- Every transaction (receive, issue, move, dispose, adjust) is logged with timestamp and cost

---

## Resetting the Database

Inside the container:

```bash
cd /app/server && node src/db/seed.js
```

This wipes and reloads all sample data.

---

## Architecture

```
backbeat/
  server/           Express API + PostgreSQL
    src/
      db/            Schema, connection, seed data
      routes/        API endpoints (parts, locations, POs, inventory)
      auth/          Google OAuth + session auth
  client/           React (Vite)
    src/
      pages/         One page per feature
      api.js         API client
  docs/              Project documentation
```
