# Backbeat - ERP System

## Overview
Backbeat is an ERP system. The first module is **Stash** (inventory management). Future modules will be added over time.

## Key Design Goal
This system is designed to be maintained and extended by **non-engineers using Claude Code** (vibe coding). The automated test suite and CI/CD pipeline serve as the primary quality gate — not human code review. All architectural decisions should prioritize making the system safe and easy to modify without deep engineering knowledge.

---

## Requirements (Stash Module)

### Users & Scale
- 5-10 users with authentication and role-based access
- ~200 part numbers
- ~20,000 items total
- Detailed user stories for the Stash module are in `docs/USER_STORIES.md`

### Authentication
- TBD (email/password, Google SSO, etc. — not yet decided)

---

## Technology Stack (Planned)

### Frontend
- React / Next.js (TBD)

### Backend
- Node.js API (TBD — framework not yet chosen)

### Database
- PostgreSQL

### Containerization
- Docker + Docker Compose for local development and sandbox environments

### Hosting
- AWS (minimal dependency — keep it portable so we're not locked in)
- Likely: EC2 or ECS for containers, S3 for backups
- Keep cloud-specific code isolated so we can migrate if needed

---

## DevOps & Pipeline (Planned)

### Local Sandbox (Developer / Non-Engineer Environment)
- Must be dead simple to set up for a non-engineer:
  1. Install Docker Desktop (one-time)
  2. Clone the repo
  3. Run `docker compose up`
- Docker Compose spins up the full stack: app + database + seed data
- Hot reloading enabled — code changes reflect instantly in the browser
- Database seed script pre-populates realistic test data

### Automated Testing
- **Unit Tests** — Test individual functions in isolation
- **Integration Tests** — Test API endpoints against a real database
- **E2E Tests (Playwright)** — Simulate real user workflows in a browser (login, add parts, etc.)
- **Schema/Migration Tests** — Verify database changes don't break existing data
- **API Contract Tests** — Verify endpoints accept correct inputs and return correct outputs
- Tests can be run locally: `npx playwright test` (use `--headed` to watch in real time)
- Tests also run automatically in GitHub Actions on every push

### CI/CD Pipeline (GitHub Actions)
- On every push/PR:
  1. Build the application
  2. Run all test suites (unit, integration, E2E)
  3. Block merge if any test fails
- No PR can merge to main unless all tests pass (enforced by GitHub branch protection)
- GitHub Actions free tier: 2,000 min/month (plenty for this scale)

### Environments
- **Sandbox** — Local Docker environment for development and vibe coding
- **QA** — Deployed environment for manual verification before production release
- **Production** — Live environment

### Release-to-Production Process
- Merge to main triggers deployment to QA
- Manual verification in QA
- Promotion from QA to Production (process TBD — could be manual approval or tag-based)
- **Rollback capability** — ability to quickly revert to a previous version if issues arise

### Database Backups
- Automated scheduled backups of the production PostgreSQL database
- Backup storage in S3
- Retention policy TBD

---

## Workflow for Non-Engineer Using Claude Code

```
1. Open project folder in Claude Code
2. Run `docker compose up` to start the sandbox
3. Describe the desired change to Claude
4. Claude makes code changes (app auto-reloads)
5. Verify the change looks right in the browser
6. Run `npx playwright test` to ensure nothing is broken
7. If tests pass, Claude pushes to GitHub
8. GitHub Actions runs tests again as a safety net
9. If pipeline passes, PR is eligible for merge to QA
```

---

## Claude Code Instructions

- Always run the full test suite before pushing code
- Never modify Docker configuration without asking the user
- Never modify CI/CD pipeline configuration without asking the user
- Always create a new branch for changes (never push directly to main)
- Write tests alongside every new feature
- Keep AWS-specific code isolated and minimal

---

## Status
**Project phase: Planning / Architecture**
Requirements gathering and architecture decisions are in progress. Nothing has been built yet beyond this document.
