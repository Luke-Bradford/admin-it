# admin-it — Product Plan

## Vision

admin-it is a self-hosted database administration panel for Microsoft SQL Server. The target user is **not a DBA** — it's the operations manager, finance analyst, or support agent who needs to interact with structured data without writing SQL. An engineer wires the connections and sets permissions once; after that, non-technical users can query, filter, export, and understand their data through a guided UI.

The commercial angle: most SMBs and mid-market companies have SQL Server databases (often from legacy ERP, CRM, or accounting systems) with no safe way to let non-engineers touch them. admin-it fills the gap between "ask a developer every time" and "give everyone SSMS access".

---

## User personas

| Persona | Who they are | What they need |
|---|---|---|
| **End user** | Ops, finance, support — not technical | Browse tables, filter rows, export data, see audit history. Never writes SQL. |
| **Power user** | Analyst or technically-minded ops person | Run saved queries, build simple reports, schedule exports. May write basic SQL. |
| **Admin** | IT engineer or senior developer | Manage connections, users, roles, permissions. Wires the tool up initially. |
| **System admin** | The person who installed admin-it | Everything — first-run setup, schema deployment, system settings, backup. |

---

## Phases

### Phase 0 — Foundation (current state)
First-run wizard, auth, JWT middleware, schema deployment into SQL Server. Mostly complete.

### Phase 1 — Core hardening (make what exists production-safe)
Fix the critical security and reliability issues before building on top.

### Phase 2 — Connection & user management (Admin persona)
The engineer can manage connections and users from the UI, not by touching the DB directly.

### Phase 3 — Data browser (End user + Power user persona)
Non-technical users can browse, filter, and export data from connected databases.

### Phase 4 — Saved queries & basic reporting (Power user persona)
Power users can build and share parameterised queries that non-technical users can run safely.

### Phase 5 — Audit & compliance (all personas)
Full audit trail UI — who did what, when, on which connection.

### Phase 6 — AI assistant (End user persona)
Natural language to SQL — the user describes what they want, the system generates and runs the query safely.

---

## Tickets

Each ticket is sized S / M / L / XL (engineer-days of effort, roughly).

---

### Phase 1 — Foundation hardening

---

#### #1 — Fix password hashing (SHA-256 → bcrypt)
**Size:** S
**Persona:** System admin (security)
**Problem:** Passwords are hashed with SHA-256 + salt. SHA-256 is fast by design, making it trivially brute-forceable with modern hardware. Any credential leak exposes all passwords.
**Acceptance criteria:**
- Passwords stored using `bcrypt` (or `argon2id`) with a work factor appropriate for self-hosted deployment
- Existing SHA-256 hashes migrated on next login (re-hash on successful password verify)
- No visible change to end users
- `requirements.txt` updated; `bcrypt` or `argon2-cffi` added

---

#### #2 — Fix startup crash before setup completes
**Size:** S
**Persona:** System admin
**Problem:** On a fresh install (before running the setup wizard), the FastAPI app crashes on startup because the `startup` event tries to load the JWT secret from a database that doesn't exist yet. The setup wizard depends on the backend being running — creating a chicken-and-egg failure.
**Acceptance criteria:**
- App starts cleanly with no config file present
- Setup routes (`/api/setup/*`) are available immediately on first start
- Protected routes return 503 or similar until setup is complete, not a crash
- `app.on_event("startup")` replaced with `lifespan` context manager (FastAPI best practice)

---

#### #3 — Cache the database engine (fix per-request engine creation)
**Size:** S
**Persona:** All (performance & reliability)
**Problem:** `get_config_and_engine()` decrypts the config file and calls `create_engine()` on every single HTTP request. SQLAlchemy's connection pool is re-created each time — defeating pooling entirely and adding unnecessary latency and file I/O to every request.
**Acceptance criteria:**
- Engine created once at startup and held as a module-level singleton
- Config decryption happens once at startup
- On config change (re-run of setup), engine is restarted cleanly
- No regression in setup wizard flow

---

#### #4 — Protect the setup delete endpoint
**Size:** S
**Persona:** System admin (security)
**Problem:** `DELETE /api/setup` has no authentication check. Any unauthenticated user who can reach the backend can destroy the core config, effectively bricking the deployment.
**Acceptance criteria:**
- `DELETE /api/setup` requires a valid JWT with `SystemAdmin` role
- Consistent with the auth pattern used on other protected routes
- Returns 401/403 appropriately

---

#### #5 — Fix ESLint configuration conflict
**Size:** S
**Persona:** Engineer (DX)
**Problem:** Two conflicting ESLint config files exist: `.eslintrc.json` (legacy) and `eslint.config.js` (ESLint 9 flat config). The `lint` script uses `--ext`, a legacy flag not supported by ESLint 9. The `--fix` flag in CI silently mutates files but never fails the build on violations.
**Acceptance criteria:**
- Single ESLint config file (flat config `eslint.config.js` for ESLint 9)
- `lint` script in `package.json` uses correct ESLint 9 invocation, no `--fix`
- `format:check` script added (Prettier check, no auto-fix) for use in CI
- `format` script (Prettier write) available for local use
- CI `frontend-check.yml` updated to use the corrected scripts
- `npm run lint` exits non-zero on any violation

---

#### #6 — Install Tailwind CSS (fix unstyled login page)
**Size:** S
**Persona:** End user (UX)
**Problem:** `LoginPage.jsx` uses Tailwind class names throughout but Tailwind is not installed. The login page has no visible styling. This is the first thing every user sees.
**Acceptance criteria:**
- Tailwind CSS installed and configured (`tailwind.config.js`, `postcss.config.js`)
- Login page renders correctly with intended styles
- Dashboard and other pages using Tailwind classes also render correctly
- No regressions in pages that use their own CSS files (`SetupPage.css`, `Header.css`)

---

#### #7 — Reconcile ORM models with deployed schema
**Size:** M
**Persona:** Engineer (maintainability)
**Problem:** `models.py` defines SQLAlchemy ORM models with integer PKs and different table names to the actual deployed schema (which uses UUIDs and different naming). `schema_manager.py` would generate incorrect DDL if ever called. Dead code (`init_core_schema.py`, `discovery.py` utils) adds confusion.
**Acceptance criteria:**
- `models.py` updated to reflect the actual deployed schema (UUIDs, correct table/column names)
- `init_core_schema.py` deleted (superseded by `spDeployCoreSchema.sql`)
- `discovery.py` util deleted or consolidated into `discovery_routes.py`
- `schema_manager.py` either wired up correctly or removed if not needed yet

---

### Phase 2 — Connection & user management

---

#### #8 — Connection management UI (list, add, edit, delete)
**Size:** L
**Persona:** Admin
**Problem:** There is no way to manage database connections from the UI. An engineer must manipulate the SQL Server schema directly.
**Background:** The deployed schema has a `Connections` table (temporal, with full history). The setup wizard already knows how to create an engine from connection details — that pattern can be reused for testing new connections before saving.
**Acceptance criteria:**
- `GET /api/connections` — list connections the logged-in user has permission to see
- `POST /api/connections` — create a new connection (Admin role required); validates and test-connects before saving
- `PATCH /api/connections/{id}` — update connection details
- `DELETE /api/connections/{id}` — soft-delete (set `IsActive = false`); SystemAdmin only
- Frontend: Connections page with table, add/edit modal, delete confirmation
- Connection credentials encrypted at rest (same Fernet pattern as core config, or per-connection key stored in `Secrets` table)

---

#### #9 — User management UI (list, invite, edit roles, deactivate)
**Size:** L
**Persona:** Admin
**Problem:** Users can only be created via the setup wizard (SystemAdmin only). There is no UI for managing users after initial setup.
**Acceptance criteria:**
- `GET /api/users` — list users (Admin role); includes role and active status
- `POST /api/users` — create user with initial role (Admin role required)
- `PATCH /api/users/{id}` — update role or active status
- `DELETE /api/users/{id}` — deactivate (soft delete, `IsActive = false`); SystemAdmin only
- Frontend: Users page with table, add user modal, inline role editor, deactivate action
- Cannot deactivate yourself
- Cannot demote the last SystemAdmin

---

#### #10 — Role-based connection permissions
**Size:** M
**Persona:** Admin
**Problem:** The schema has a `ConnectionPermissions` table (read/write/admin per connection per role), but no UI or API exposes it. All authenticated users effectively see all connections.
**Acceptance criteria:**
- `GET /api/connections/{id}/permissions` — list which roles have which access
- `POST /api/connections/{id}/permissions` — grant a role access (Admin + connection admin required)
- `DELETE /api/connections/{id}/permissions/{role_id}` — revoke access
- Connection list API (`#8`) filters by the calling user's permissions
- Frontend: Permissions tab on the connection edit modal

---

#### #11 — User profile & password change
**Size:** S
**Persona:** End user
**Problem:** Users cannot change their own password. The only way to update a password is direct database manipulation.
**Acceptance criteria:**
- `POST /api/auth/change-password` — requires current password + new password; re-hashes with bcrypt (#1 must be done first)
- Frontend: Profile page or settings modal with password change form
- Minimum password length enforced (12 chars)

---

### Phase 3 — Data browser

---

#### #12 — Table browser (list schemas and tables)
**Size:** M
**Persona:** End user
**Problem:** There is no way for a user to see what data is available in a connected database.
**Background:** This requires querying `INFORMATION_SCHEMA` on the target connection, not the admin-it schema. A new class of "target connection" engine is needed, distinct from the core engine.
**Acceptance criteria:**
- `GET /api/connections/{id}/schemas` — list schemas on the target database
- `GET /api/connections/{id}/schemas/{schema}/tables` — list tables with row counts and column summary
- `GET /api/connections/{id}/schemas/{schema}/tables/{table}/columns` — column names, types, nullability
- User must have at least read permission on the connection
- Frontend: Left-hand nav tree — connections → schemas → tables; clicking a table opens the data browser

---

#### #13 — Data browser (paginated row view with column filtering)
**Size:** L
**Persona:** End user
**Problem:** The core value of the product: let a non-technical user see and filter the data in a table without writing SQL.
**Acceptance criteria:**
- `GET /api/connections/{id}/data/{schema}/{table}` — paginated rows (default 50/page), with optional column filter params
- Filter params: column name + operator (equals, contains, starts with, is null, greater than, less than, between) + value — all validated server-side, never interpolated unsafely
- Sort by column (asc/desc)
- Column visibility toggle (hide irrelevant columns)
- Frontend: Data grid with pagination, column header sort/filter, column picker
- Row count shown; total pages calculated
- Loading state and empty state handled

---

#### #14 — Data export (CSV / Excel)
**Size:** M
**Persona:** End user + Power user
**Problem:** Users need to take data away to use in reports or share with colleagues. Currently impossible.
**Acceptance criteria:**
- `GET /api/connections/{id}/data/{schema}/{table}/export` — same filter params as #13; returns CSV or XLSX (accept header or `?format=csv`)
- Max export row limit (configurable, default 10,000) with clear UI warning when limit is hit
- Export respects the same column filters as the browser view
- Frontend: Export button in the data browser; format picker; progress indicator for large exports
- Exports logged to audit trail (who exported what, when, row count)

---

#### #15 — Column-level data masking
**Size:** M
**Persona:** Admin + End user (compliance)
**Problem:** Some columns contain sensitive data (PII, financial) that should not be visible to all users. Currently there is no way to restrict column-level visibility.
**Acceptance criteria:**
- Admin can mark columns as masked per-connection (stored in admin-it schema)
- Masked columns shown as `****` in the data browser for users without elevated permission
- Masked columns excluded from exports for unprivileged users
- Masking configuration accessible in the connection permissions UI (#10)
- Audit trail records when a masked column is accessed by a privileged user

---

### Phase 4 — Saved queries & basic reporting

---

#### #16 — Saved query library (parameterised, no raw SQL for end users)
**Size:** XL
**Persona:** Power user creates; End user runs
**Problem:** Power users often need the same data filtered in different ways (e.g. "show me all orders for customer X in date range Y"). Today they either ask a developer to write a script or get raw database access. Neither is safe or efficient.
**Background:** The pattern is: an engineer or power user writes a query with named parameters (`WHERE customer_id = :customer_id AND order_date BETWEEN :start_date AND :end_date`). Non-technical users see a form with labelled inputs, fill them in, and get results — never seeing the SQL.
**Acceptance criteria:**
- `POST /api/queries` — save a named, parameterised query with connection reference and parameter schema (name, type, label, required/optional, default)
- `GET /api/queries` — list queries visible to the calling user
- `POST /api/queries/{id}/run` — execute a saved query with supplied parameter values; parameters validated against schema before execution; only SELECT statements permitted
- Frontend: Query library page; run panel shows a generated form from the parameter schema; results in data grid with export (#14 reused)
- Power user / Admin can create and edit queries; End users can only run them
- Query text is never exposed to End users in the UI

---

#### #17 — Query scheduling & email delivery
**Size:** XL
**Persona:** Power user
**Problem:** Recurring reports (weekly sales, daily exceptions) require manual intervention today.
**Acceptance criteria:**
- Schedule a saved query (#16) to run on a cron schedule
- Results delivered as CSV attachment to one or more email addresses
- Email sending via configurable SMTP (admin-it system settings)
- Schedule stored in admin-it schema; job runner executes on the backend (APScheduler or similar)
- Failed runs logged; admin notified on consecutive failures
- Frontend: Schedule tab on saved query editor

---

### Phase 5 — Audit & compliance

---

#### #18 — Audit log UI
**Size:** M
**Persona:** Admin + System admin
**Problem:** The SQL Server temporal tables log all changes to the admin-it schema, but there is no way to view this history from the application. An engineer must query the DB directly.
**Acceptance criteria:**
- `GET /api/audit` — paginated audit log (who, what table, what action, before/after values, when)
- Filter by user, table, date range, action type (INSERT/UPDATE/DELETE)
- Frontend: Audit log page (Admin+ only); searchable, filterable table; expandable rows showing before/after JSON diff
- Data query audit (from #13/#14/#16) also logged and surfaced here

---

#### #19 — Login history & active sessions
**Size:** S
**Persona:** Admin
**Problem:** No visibility into who has logged in, from where, or whether suspicious access has occurred.
**Acceptance criteria:**
- Login events logged (user, timestamp, IP address, success/failure)
- `GET /api/users/{id}/login-history` — last N logins for a user (Admin or own user)
- Account lockout after N consecutive failed logins (configurable, default 5)
- Lockout can be cleared by Admin
- Frontend: Login history tab on user detail page

---

### Phase 6 — AI assistant

---

#### #20 — Natural language query (AI → SQL → results)
**Size:** XL
**Persona:** End user
**Problem:** Even with the data browser (#13), some questions don't fit a simple filter ("show me the top 10 customers by revenue last quarter where they haven't ordered in 30 days"). The end user is stuck.
**Background:** The product already has the Claude API key pattern from the PR review workflow. The AI assistant uses the same API. The schema is always available (from #12). The safety model: AI generates a SELECT-only query, shown to the user for confirmation before execution, executed via the same parameterised engine — never DDL, never DML.
**Acceptance criteria:**
- User types a plain English question in the context of a table or connection
- System sends the schema context + question to Claude; Claude returns a SQL SELECT query with explanation
- Query shown to user before execution ("Here's what I'll run — does this look right?")
- User confirms → query executed → results in data grid
- If Claude cannot generate a safe query, it explains why rather than guessing
- All AI-generated queries logged in audit trail with the original natural language prompt
- Works only on connections the user has read access to
- Generated SQL never contains DDL, DML, or stored procedure calls — validated server-side before execution
- Frontend: AI chat panel that opens in context of the current table/connection

---

## What we are explicitly not building (scope boundaries)

- **Write access to target databases** — admin-it is read-only for end users. Engineers can write via SSMS or their own tools. The risk of a non-technical user accidentally mutating production data is unacceptable.
- **Multi-database-vendor support** — SQL Server only, initially. The schema, temporal tables, and pyodbc driver choice are all SQL Server specific. PostgreSQL / MySQL support is a future phase.
- **A general SQL IDE** — We are not building SSMS in the browser. Power users can use saved queries; raw SQL execution is not a first-class feature for end users.
- **Row-level security on target databases** — Column masking (#15) is the extent of data restriction admin-it enforces. Row-level filtering based on the logged-in user's identity is not in scope.

---

## Immediate next actions (in order)

1. **#1 bcrypt** — security, small, no dependencies
2. **#2 startup crash fix** — blocks any reliable testing
3. **#3 engine caching** — reliability, small
4. **#4 protect delete endpoint** — security, trivial
5. **#5 ESLint fix + #6 Tailwind** — unblock frontend development (CI will fail until these are fixed)
6. **#7 reconcile ORM** — clear the dead code before building on top
7. Then Phase 2 (connections + users) — the minimum for an engineer to hand off to a non-technical user
