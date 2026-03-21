# admin-it — Product Plan

## Vision

admin-it is a self-hosted database administration panel for Microsoft SQL Server. The target user is **not a DBA** — it's the operations manager, finance analyst, or support agent who needs to interact with structured data without writing SQL. An engineer wires the connections and sets permissions once; after that, non-technical users can query, filter, export, and understand their data through a guided UI.

The commercial angle: most SMBs and mid-market companies have SQL Server databases (often from legacy ERP, CRM, or accounting systems) with no safe way to let non-engineers touch them. admin-it fills the gap between "ask a developer every time" and "give everyone SSMS access".

---

## Deployment model

**Single-instance, multi-environment aware.**

One admin-it installation per team or org unit. It maintains its own admin schema on a single SQL Server database, but can connect out to any number of *target databases* on any reachable server.

**Dev→prod workflow:** An engineer deploys the admin-it schema to the prod SQL Server using the same idempotent deployment script (`spDeployCoreSchema.sql`). The prod instance is then configured independently — connection strings, users, and permissions are entered manually. No config is transferred between instances. Schema changes (new tables, columns, stored procedures) are promoted to prod by re-running the deployment script — which must be fully idempotent (`IF NOT EXISTS`, `ALTER TABLE` for new columns, never `DROP/CREATE` on objects with data).

---

## User personas

| Persona | Who they are | What they need |
|---|---|---|
| **End user** | Ops, finance, support — not technical | Browse tables, filter rows, export data. Never writes SQL. Read or write based on their table-level permissions. |
| **Power user** | Analyst or technically-minded ops person | Run saved queries, build simple reports, schedule exports. May write basic SQL. |
| **Admin** | IT engineer or senior developer | Manage connections, users, roles, permissions. Wires the tool up initially. |
| **System admin** | The person who installed admin-it | Everything — first-run setup, schema deployment, system settings, backup. |

---

## Permission model

### Connection-level access

Every user gets a connection-level permission for each connection they can see:

| Level | Can do |
|-------|--------|
| `Read` | Browse all tables in connection (read-only) |
| `Write` | Browse all tables; can edit/insert/delete rows where not overridden |
| `Admin` | Write access + can manage permissions on this connection |

### Table-level overrides

Table-level permissions **override** the connection-level default for specific tables:

- Connection `Write` + Table `Read` override → user is read-only on that table, write everywhere else
- Connection `Read` + Table `Write` override → user can write on that table, read everywhere else

**Resolution rule:** If a `TablePermissions` row exists for `(user, connection, schema, table)`, use it. Otherwise inherit connection-level permission.

### Write operations

Write access (where permitted) means: inline row editing in the data browser, adding new rows, deleting rows. The target database enforces NOT NULL, FK constraints, and all other integrity rules. admin-it catches DB errors and returns clean user-facing messages — no raw SQL exceptions exposed.

### Credential model

admin-it connects to target databases using a **service account** configured per connection (SQL auth username + password). End users never need database credentials. The service account is stored encrypted at rest.

**Credential storage — phased approach:**
- **Phase 2:** Fernet-encrypted inline (key in `[adm].[Secrets]`). Admin-only access to view/change.
- **Later:** Azure Key Vault support — connection stores a Key Vault secret reference (`keyvault://vault-name/secret-name`). admin-it authenticates via managed identity or service principal. The `Connections` table has a `CredentialSource` column from day one (`inline` | `keyvault`) to avoid a schema migration later.

---

## Design principles

- **Clean, professional, functional.** This is an internal tool used daily by non-technical staff. It must feel polished, not like a developer prototype. No decorative flourishes — clarity and consistency over visual noise.
- **Simple user experience.** If a user has to think about how to do something, the UI has failed. Permissions are invisible to the user — they see only what they can do, never what they can't.
- **No raw SQL for end users.** Ever. Saved queries expose a form; the data browser exposes filters. SQL stays server-side.
- **Security in depth.** Auth ≠ authz. Every operation checks both. No user input interpolated into SQL. Credentials never leave the server unencrypted.

---

## Phases

### Phase 0 — Foundation (complete)
First-run wizard, auth, JWT middleware, schema deployment into SQL Server.

### Phase 1 — Core hardening (in progress)
Fix critical security and reliability issues before building on top. No new features until this is done.

### Phase 2 — Connection & user management (Admin persona)
Engineer can manage connections, users, and permissions from the UI. Minimum viable product for handing off to a non-technical admin.

### Phase 3 — Data browser (End user + Power user)
Browse, filter, and interact with data from connected databases. Read and write based on table-level permissions.

### Phase 4 — Saved queries & basic reporting (Power user)
Parameterised queries built by power users, run safely by end users via a generated form.

### Phase 5 — Audit & compliance (all personas)
Full audit trail UI surfacing SQL Server temporal table history. Login history, account lockout visibility.

### Phase 6 — AI assistant (End user)
Natural language to SQL — user describes what they want, Claude generates a SELECT, user confirms before execution.

---

## Schema additions required (vs current deployed schema)

### New table: `[adm].[TablePermissions]`
Stores table-level permission overrides. If no row exists, connection-level permission is inherited.

```sql
TablePermissionId  UNIQUEIDENTIFIER  PRIMARY KEY DEFAULT NEWID()
ConnectionId       UNIQUEIDENTIFIER  NOT NULL  REFERENCES [adm].[Connections]
SchemaName         NVARCHAR(128)     NOT NULL
TableName          NVARCHAR(128)     NOT NULL
UserId             UNIQUEIDENTIFIER  NOT NULL  REFERENCES [adm].[Users]
PermissionType     NVARCHAR(20)      NOT NULL  -- 'Read' | 'Write' | 'Admin'
-- Temporal versioning (SYSTEM_VERSIONING = ON)
```

### Column addition: `[adm].[Connections].CredentialSource`
```sql
CredentialSource   NVARCHAR(20)      NOT NULL  DEFAULT 'inline'  -- 'inline' | 'keyvault'
CredentialRef      NVARCHAR(500)     NULL       -- Key Vault URI when CredentialSource = 'keyvault'
```

---

## Tickets

Each ticket is sized S / M / L / XL (engineer-days of effort, roughly).

---

### Phase 1 — Foundation hardening

---

#### #44 — Fix password hashing (SHA-256 → argon2id)
**Size:** S
**GitHub:** https://github.com/Luke-Bradford/admin-it/issues/44
**Problem:** Passwords hashed with SHA-256 — trivially brute-forceable on any credential leak.
**Acceptance criteria:**
- `argon2-cffi` added to `requirements.txt`
- New passwords hashed with argon2id
- Existing SHA-256 hashes migrated transparently on next successful login
- `ruff check` and `ruff format --check` pass

---

#### #45 — Fix startup crash before setup completes
**Size:** S
**GitHub:** https://github.com/Luke-Bradford/admin-it/issues/45
**Problem:** App crashes on startup if no config file exists — setup wizard unreachable on fresh install.
**Acceptance criteria:**
- Replace `@app.on_event("startup")` with `lifespan` context manager
- Startup completes cleanly with no config present
- Setup routes available immediately
- Protected routes return `503` (not crash) if JWT secret not yet loaded

---

#### #46 — Cache the database engine
**Size:** S
**GitHub:** https://github.com/Luke-Bradford/admin-it/issues/46
**Problem:** `get_config_and_engine()` recreates the SQLAlchemy engine on every HTTP request — no connection pooling, unnecessary file I/O and decryption on every call.
**Acceptance criteria:**
- Engine created once at startup, held as singleton
- Config decrypted once at startup
- Engine restarted cleanly on setup config change without server restart

---

#### #47 — Protect the setup delete endpoint
**Size:** S
**GitHub:** https://github.com/Luke-Bradford/admin-it/issues/47
**Problem:** `DELETE /api/setup` has no authentication — any unauthenticated user can destroy the deployment.
**Acceptance criteria:**
- `DELETE /api/setup` requires valid JWT with `SystemAdmin` role
- Returns `401`/`403` appropriately

---

#### #48 — Fix ESLint configuration conflict
**Size:** S
**GitHub:** https://github.com/Luke-Bradford/admin-it/issues/48
**Problem:** Two conflicting ESLint configs (legacy `.eslintrc.json` + ESLint 9 flat `eslint.config.js`).
**Acceptance criteria:**
- `.eslintrc.json` deleted
- `npm run lint` correct for ESLint 9, exits non-zero on violations
- `npm run format:check` runs Prettier in check mode for CI

---

#### #49 — Install Tailwind CSS
**Size:** S
**GitHub:** https://github.com/Luke-Bradford/admin-it/issues/49
**Problem:** All pages use Tailwind classes but Tailwind is not installed — UI completely unstyled.
**Acceptance criteria:**
- `tailwindcss`, `postcss`, `autoprefixer` installed
- `tailwind.config.js` and `postcss.config.js` created
- All pages render with intended styles, no regressions

---

#### #50 — Reconcile ORM models and delete dead code
**Size:** M
**GitHub:** https://github.com/Luke-Bradford/admin-it/issues/50
**Problem:** `models.py` is out of sync with the deployed schema. Multiple dead files add confusion.
**Acceptance criteria:**
- `models.py`, `init_core_schema.py`, `discovery.py` (util), `OtherPage.jsx`, `HomePage.jsx` deleted
- `pydantic<2.0.0` bumped to `pydantic>=2.0.0,<3.0.0`; any v1-specific syntax updated
- All checks pass

---

#### #51 — Fix CORS hardcoded to localhost
**Size:** S
**GitHub:** https://github.com/Luke-Bradford/admin-it/issues/51
**Problem:** `allow_origins=["http://localhost:3000"]` hardcoded — breaks in any non-local environment.
**Acceptance criteria:**
- CORS origins loaded from `CORS_ORIGINS` environment variable
- `docker-compose.yml` and `.env.example` updated

---

#### #59 — Finalize Docker Compose setup
**Size:** S
**GitHub:** https://github.com/Luke-Bradford/admin-it/issues/59
**Problem:** Docker setup not documented or environment-variable driven.
**Acceptance criteria:**
- All environment-specific config via env vars
- `.env.example` documents every variable
- README quickstart works on a fresh machine

---

### Phase 2 — Connection & user management

---

#### #52 — App shell: sidebar navigation and layout
**Size:** M
**GitHub:** https://github.com/Luke-Bradford/admin-it/issues/52
**Problem:** No navigation shell — every Phase 2+ page would be bolted onto a placeholder dashboard.
**Acceptance criteria:**
- Persistent sidebar: Dashboard, Connections, Users, Audit Log (inactive items greyed until implemented)
- Responsive — collapses to icons on narrow viewports
- Breadcrumb component for nested routes
- All protected pages use new layout

---

#### #53 — Connection management API
**Size:** M
**GitHub:** https://github.com/Luke-Bradford/admin-it/issues/53
**Problem:** No API to manage database connections.
**Includes:** `CredentialSource` column on `Connections` table, Fernet-encrypted inline credentials.
**Acceptance criteria:**
- `GET /api/connections` — filtered by user's `UserConnectionAccess`
- `POST /api/connections` — Admin role; validates + test-connects before saving; credentials encrypted
- `PATCH /api/connections/{id}` — Admin role
- `DELETE /api/connections/{id}` — soft-delete; SystemAdmin only

---

#### #54 — Connection management UI
**Size:** M
**GitHub:** https://github.com/Luke-Bradford/admin-it/issues/54
**Depends on:** #52, #53

---

#### #55 — User management API
**Size:** M
**GitHub:** https://github.com/Luke-Bradford/admin-it/issues/55
**Problem:** No API to manage users after initial setup.
**Acceptance criteria:**
- `GET /api/users`, `POST /api/users`, `PATCH /api/users/{id}`, `DELETE /api/users/{id}`
- Role checks: cannot deactivate self, cannot demote last SystemAdmin
- Passwords hashed with argon2id (#44 dependency)

---

#### #56 — User management UI
**Size:** M
**GitHub:** https://github.com/Luke-Bradford/admin-it/issues/56
**Depends on:** #52, #55

---

#### #57 — User profile page and password change
**Size:** S
**GitHub:** https://github.com/Luke-Bradford/admin-it/issues/57
**Depends on:** #44

---

#### #58 — Role-based connection permissions (connection + table level)
**Size:** M
**GitHub:** https://github.com/Luke-Bradford/admin-it/issues/58
**Includes:** Deploy `[adm].[TablePermissions]` table; API and UI for granting/revoking connection-level and table-level permissions.
**Depends on:** #53, #54

---

#### #60 — Login hardening: rate limiting and account lockout
**Size:** S
**GitHub:** https://github.com/Luke-Bradford/admin-it/issues/60

---

### Phase 3 — Data browser

---

#### #12 — Table browser (list schemas and tables)
**Size:** M
**Problem:** No way to see what data is available in a connected database.
**Acceptance criteria:**
- `GET /api/connections/{id}/schemas` — list schemas on target database
- `GET /api/connections/{id}/schemas/{schema}/tables` — tables with row counts and column summary
- `GET /api/connections/{id}/schemas/{schema}/tables/{table}/columns` — column names, types, nullability
- User must have at least Read permission on the connection
- Frontend: left-hand tree nav — connections → schemas → tables

---

#### #13 — Data browser (paginated row view, filtering, inline editing)
**Size:** L
**Problem:** Core product value — let non-technical users see, filter, and (where permitted) edit data without SQL.
**Acceptance criteria:**
- `GET /api/connections/{id}/data/{schema}/{table}` — paginated rows with optional column filters
- Filter operators: equals, contains, starts with, is null, greater than, less than, between
- Sort by column (asc/desc)
- Column visibility toggle
- **Write access (where permitted):** inline row editing, add new row, delete row
  - Write operations use `PUT /api/connections/{id}/data/{schema}/{table}/{pk}` (update), `POST` (insert), `DELETE` (delete)
  - Permission check: resolve table-level override → fall back to connection-level
  - Target DB constraint violations (NOT NULL, FK, etc.) caught and returned as clean user-facing errors — no raw SQL exceptions
- Loading, empty, and error states handled

---

#### #14 — Data export (CSV / Excel)
**Size:** M
**Acceptance criteria:**
- Same filter params as #13; returns CSV or XLSX
- Max export row limit (configurable, default 10,000) with UI warning when hit
- Exports logged to audit trail

---

#### #15 — Column-level data masking
**Size:** M
**Acceptance criteria:**
- Admin can mark columns as masked per connection
- Masked columns shown as `****` for users without elevated permission
- Masked columns excluded from exports for unprivileged users

---

### Phase 4 — Saved queries & basic reporting

---

#### #16 — Saved query library
**Size:** XL
**Problem:** Power users need parameterised queries; end users need to run them safely without seeing SQL.

---

#### #17 — Query scheduling & email delivery
**Size:** XL

---

### Phase 5 — Audit & compliance

---

#### #18 — Audit log UI
**Size:** M

---

#### #19 — Login history & active sessions
**Size:** S

---

### Phase 6 — AI assistant

---

#### #20 — Natural language query (AI → SQL → results)
**Size:** XL
**Safety model:** AI generates SELECT-only query, shown to user for confirmation before execution. Server-side validation rejects any DDL, DML, or stored procedure calls. All AI queries logged with original natural language prompt.

---

## Scope boundaries

- **Write access to target databases:** Permitted and role-gated per table. The target database enforces all integrity constraints. admin-it enforces permission checks and surfaces clean error messages.
- **Multi-database-vendor support:** SQL Server only initially. PostgreSQL/MySQL is a future phase.
- **A general SQL IDE:** Not building SSMS in the browser. End users get a data browser and saved query runner. Raw SQL execution is not exposed to end users.
- **Row-level security on target databases:** Not in scope. Column masking (#15) is the extent of admin-it's data restriction. Row-level filtering based on user identity is a future consideration.
- **Config transfer between instances:** Not supported. Each admin-it instance is configured independently. Schema changes (DDL) are promoted via the idempotent deployment script.

---

## Immediate next actions (Phase 1, in order)

1. **#47** — Protect `DELETE /api/setup` (security, 30 min)
2. **#45** — Fix startup crash / lifespan migration (reliability, 2h)
3. **#46** — Cache database engine (performance, 2h)
4. **#44** — argon2id password hashing (security, 2h)
5. **#48** — Fix ESLint config (DX, 1h)
6. **#49** — Install Tailwind CSS (frontend, 1h)
7. **#50** — Delete dead code, bump Pydantic v2 (tech debt, 3h)
8. **#51** — Fix CORS (ops, 30 min)
9. **#59** — Finalize Docker Compose (ops, 2h)
