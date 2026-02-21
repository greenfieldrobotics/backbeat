# Getting Started - Backbeat / Stash MVP

## Prerequisites

- **Node.js** (v18+) — `node --version` to check
- **npm** — comes with Node.js

## Quick Start

```bash
# 1. Install dependencies
cd server && npm install && cd ..
cd client && npm install && cd ..

# 2. Seed the database with sample data
cd server && npm run seed && cd ..

# 3. Start both servers (from project root)
npm run dev
```

This starts:
- **API server** at http://localhost:3001
- **React app** at http://localhost:5173

Open http://localhost:5173 in your browser.

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
- Every transaction (receive, issue) is logged with timestamp and cost

## Resetting the Database

```bash
cd server && npm run seed
```

This wipes and reloads all sample data.

## Architecture

```
backbeat/
  server/           Express API + SQLite
    src/
      db/            Schema, connection, seed data
      routes/        API endpoints (parts, locations, POs, inventory)
    data/            SQLite database file (gitignored)
  client/           React (Vite)
    src/
      pages/         One page per feature
      api.js         API client
  docs/              Project documentation
```
