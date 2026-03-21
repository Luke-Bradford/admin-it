# admin-it — Claude Code Instructions

## Branch and PR workflow — non-negotiable

1. **Create a branch before writing any code.** Never commit to `main` directly.
   Naming: `feature/<issue-number>-short-description` or `fix/<issue-number>-short-description`.
2. **All commits go on the branch.** If a commit lands on `main` by mistake, stop and fix — do not branch after the fact.
3. **Push branch → open PR → wait for Claude review to run.**
4. **Address every review comment** on the same branch. Reply to each with what was done + commit SHA.
5. **Re-run all checks** (lint, format, ruff) before pushing the follow-up commit.
6. **Merge only after PR is approved. Delete the branch after merge.**

---

## Pre-PR checklist (run before raising a PR)

Before pushing a branch or creating a PR, verify all of these pass locally:

### Frontend
```bash
cd frontend
npm run lint           # ESLint — must exit 0
npm run format:check   # Prettier check — must exit 0
```

### Backend
```bash
cd backend
ruff check .           # Lint — must exit 0
ruff format --check .  # Format check — must exit 0
```

If format check fails, run `ruff format .` to auto-fix, then re-check.

---

## Known CI gotchas

- **Backend `ruff.toml`** sets `line-length = 120`. New code should stay under 120 chars.
- **CRLF line endings** on Windows will trigger LF warnings from Git — these are cosmetic and do not affect CI.
- **Claude review workflow** uses `claude-sonnet-4-6` (not opus) to keep costs down.

---

## Security non-negotiables

- Never interpolate user-controlled input into raw SQL. Use `sqlalchemy.text()` with named bind parameters only.
- The schema name (`config.schema`) may be f-string interpolated into SQL — it comes from the encrypted config file, not from user HTTP input. This is a documented, acceptable pattern.
- Every new protected route must use `Depends(verify_token)` from `app.utils.auth_dependency`.
- Authentication ≠ authorisation. A valid JWT proves the user is logged in. Check their role separately for any operation that requires elevated access.

---

## Stack notes

- **Backend:** Python 3.11, FastAPI, SQLAlchemy (raw `text()` queries — no ORM for runtime queries), Pydantic v2, pyodbc for MSSQL
- **Frontend:** React 19, Vite, React Router v6, plain `fetch` (no axios despite it being installed)
- **Database:** SQL Server only. Temporal tables used for all audit history in the core schema.
- **Auth:** JWT HS256, stored in localStorage. Secret loaded from `[adm].[Secrets]` at startup into `settings.JWT_SECRET`.

---

## Repo structure

```
backend/
  app/
    routes/        # FastAPI routers — one file per domain
    utils/         # Shared utilities (auth, db helpers, config)
    database/      # Schema deployment scripts and setup logic
    sql/           # Raw SQL scripts (spDeployCoreSchema.sql)
    main.py        # App factory, startup, route registration
    db.py          # DatabaseConfig, engine factory, fetch_secret
    settings.py    # Module-level singletons (JWT_SECRET, etc.)
  ruff.toml        # Ruff config (line-length=120, excludes dead code)
frontend/
  src/
    pages/         # Route-level page components
    components/    # Shared UI components (Header, RequireAuth, etc.)
  package.json     # lint = eslint, format:check = prettier --check
.github/
  workflows/
    ci.yml             # Frontend lint/format + backend ruff on every push/PR
    claude-review.yml  # Claude Sonnet PR reviewer (needs ANTHROPIC_API_KEY secret)
PRODUCT_PLAN.md    # Full product vision, personas, phases, and tickets
```
