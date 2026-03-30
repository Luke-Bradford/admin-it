# admin-it — Product Plan

## Vision

admin-it is a self-hosted database administration panel for SQL Server and PostgreSQL. The target user is **not a DBA** — it's the operations manager, finance analyst, or support agent who needs to interact with structured data without writing SQL. An engineer wires the connections and sets permissions once; after that, non-technical users can query, filter, export, and understand their data through a guided UI.

The commercial angle: most SMBs and mid-market companies have SQL Server or PostgreSQL databases (often from legacy ERP, CRM, or accounting systems) with no safe way to let non-engineers touch them. admin-it fills the gap between "ask a developer every time" and "give everyone SSMS/psql access".

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

### Phase 1.5 — Frontend overhaul
Replace the hand-rolled setup page CSS and inconsistent Tailwind usage with a cohesive, professional design system applied across every page. No new features — purely visual quality.

### Phase 2 — Connection & user management (Admin persona)
The engineer can manage connections and users from the UI, not by touching the DB directly.

### Phase 2.5 — Multi-database core
Extend admin-it's own schema to run on either SQL Server or PostgreSQL. The setup wizard gains a database type picker, a "create new database" option for PostgreSQL, and the ability to detect and connect to an existing install rather than always deploying fresh.

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

#### #1 — Fix password hashing (SHA-256 → argon2id)
**Size:** S
**Persona:** System admin (security)
**Problem:** Passwords are hashed with SHA-256 + salt. SHA-256 is fast by design, making it trivially brute-forceable with modern hardware. Any credential leak exposes all passwords.
**Acceptance criteria:**
- Passwords stored using `argon2id` (via `argon2-cffi`) — preferred over bcrypt as it is memory-hard and the current OWASP recommendation
- Existing SHA-256 hashes migrated on next login (re-hash on successful password verify)
- No visible change to end users
- `requirements.txt` updated with `argon2-cffi`

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
- `POST /api/auth/change-password` — requires current password + new password; re-hashes with argon2id (#1 must be done first)
- Frontend: Profile page or settings modal with password change form
- Minimum password length enforced (12 chars)

---

### Phase 1.5 — Frontend overhaul

---

#### #71 — Design system foundation
**Size:** S
**Persona:** All (UX/DX)
**Problem:** The UI is inconsistent — the setup page uses a hand-rolled dark CSS file from early development, the login page and authenticated shell use Tailwind inconsistently, and the overall product looks like a learning project rather than a professional tool. Before building more features on top, the visual foundation needs to be solid.
**Background:** The stack stays as React + Tailwind. This ticket establishes a small set of reusable primitives (typography scale, colour tokens, button variants, input, card, modal, badge) that all subsequent UI work builds on. No new features — purely design infrastructure.
**Acceptance criteria:**
- Defined colour palette: neutral greys, a single brand-blue accent, semantic colours for success/warning/error
- Typography: consistent type scale using Inter or similar system-friendly font; heading, body, label, caption sizes defined
- Shared components created: `Button` (primary/secondary/danger/ghost), `Input`, `Card`, `Modal`, `Badge`, `EmptyState`, `Spinner`
- All components use Tailwind utility classes only — no new CSS files introduced
- Storybook or a simple component gallery page is not required; components are used directly in subsequent tickets
- `npm run lint` and `npm run format:check` pass

---

#### #72 — Redesign login page
**Size:** S
**Persona:** End user (first impression)
**Problem:** The login page is the first thing every user sees. It currently renders as a basic centred form with inconsistent styling — not appropriate for a product used in a business context.
**Acceptance criteria:**
- Clean, centred card layout on a neutral background
- AdminIT logo/wordmark in the header
- Username and password fields using the shared `Input` component (#71)
- Sign in button using shared `Button` (primary) component
- Inline error message on failed login (wrong credentials, account locked)
- Responsive: looks correct at 1024px and above
- No regressions in auth flow

---

#### #73 — Redesign setup wizard
**Size:** M
**Persona:** System admin (first-run experience)
**Problem:** The setup wizard is the first screen a System Admin sees after install. It currently uses a hand-rolled dark CSS file with a cramped three-card layout that does not reflect the quality of the product. The wizard also needs to be restructured to support the multi-database setup flow introduced in Phase 2.5 (#78, #79).
**Background:** This ticket redesigns the visual presentation of the existing wizard only — it does not add new database backend support (that is Phase 2.5). The wizard steps remain: database connection → schema deployment → create admin user. The "detect existing install" and "create new database" flows are wired in during Phase 2.5 but the visual scaffolding for them can be laid here.
**Acceptance criteria:**
- Full-page wizard layout with a clear step indicator (step 1 of 3, etc.)
- Each step rendered as a clean form card using shared components (#71)
- Database connection form: host, port, database, username, password, ODBC driver — clear labels, helper text where needed
- "Use localhost alias" toggle styled as a proper labelled checkbox
- Test connection button shows inline success/error feedback without a page reload
- Schema deployment step shows a progress indicator during deploy, then a clear success/failure state
- Create admin user step: username, password, confirm password with validation
- Consistent light theme — no dark CSS file
- `npm run lint` and `npm run format:check` pass

---

#### #74 — Redesign authenticated shell (sidebar, topbar, dashboard)
**Size:** M
**Persona:** All authenticated users
**Problem:** The authenticated shell (sidebar + topbar + page content area) is functional but visually rough. The sidebar collapse behaviour, active states, and typography are inconsistent. The dashboard is a placeholder card grid with no useful content.
**Acceptance criteria:**
- Sidebar: consistent active/hover states, proper icon alignment, smooth collapse, correct "coming soon" treatment for unimplemented items
- Topbar: breadcrumb, username, and sign-out button using shared components; consistent height and border
- Dashboard: replaced with a meaningful landing page — summary cards showing connection count, user count, recent activity (static/empty states are fine where data isn't yet available)
- Page-level layout: consistent padding, max-width, and heading hierarchy across Dashboard, Connections, and any other implemented pages
- All pages pass `npm run lint` and `npm run format:check`

---

### Phase 2.5 — Multi-database core

---

#### #75 — Abstract the core database layer
**Size:** M
**Persona:** Engineer (architecture)
**Problem:** The entire backend assumes SQL Server — pyodbc connection strings, MSSQL-specific SQL syntax, temporal table queries, and ODBC driver configuration are woven throughout. Adding PostgreSQL support requires a clean abstraction boundary first.
**Background:** admin-it's *own* schema (users, connections, audit log, etc.) is what needs to run on either backend. The *target* databases that users browse remain SQL Server for now (Phase 3+). This ticket is purely about the admin-it core schema layer.
**Acceptance criteria:**
- `CoreBackend` protocol/interface defined: `get_engine()`, `deploy_schema()`, `test_connection()`, `get_audit_records()`
- `MSSQLBackend` created wrapping the existing SQL Server logic — no behaviour change, just restructured behind the interface
- All existing routes continue to work through the abstracted interface
- Backend selection driven by a `CORE_DB_TYPE` config value (`mssql` | `postgres`)
- `ruff check` and `ruff format --check` pass

---

#### #76 — PostgreSQL backend for the core schema
**Size:** M
**Persona:** System admin (install on Postgres)
**Problem:** System admins running Linux infrastructure, cloud-hosted environments, or organisations without a SQL Server licence have no way to install admin-it.
**Background:** PostgreSQL does not have temporal tables. Audit history is implemented using a single `audit_log` table populated by:
- **Triggers** (for schema-managed tables): `AFTER INSERT/UPDATE/DELETE` triggers write `old_data`/`new_data` as JSONB, with the app user ID passed via `SET LOCAL app.current_user_id`.
- **Explicit writes** (for application-level events): data exports, login events, query executions written directly from Python.
This gives the same query interface as the SQL Server audit log — the audit UI (#18) queries `audit_log` regardless of backend.
**Acceptance criteria:**
- `PostgreSQLBackend` implements `CoreBackend` interface (#75)
- Core schema deployed via a `spDeployCoreSchema_postgres.sql` equivalent (plain SQL, no temporal syntax)
- `audit_log` table created with: `id`, `table_name`, `record_id`, `action` (INSERT/UPDATE/DELETE), `changed_by`, `changed_at`, `old_data` (JSONB), `new_data` (JSONB)
- Triggers created on all mutable core tables (Users, Connections, ConnectionPermissions, Secrets)
- Session variable `app.current_user_id` set at the start of each request via SQLAlchemy event hook; triggers read it to populate `changed_by`
- `GET /api/audit` returns the same response shape regardless of backend
- Connection uses `psycopg2` or `asyncpg` via SQLAlchemy; added to `requirements.txt`
- All existing routes pass against a Postgres instance in CI

---

#### #77 — SQL Server: add explicit audit_log table
**Size:** S
**Persona:** Admin + System admin (audit)
**Problem:** SQL Server temporal tables record row-level history but do not capture application-level context — which admin-it user triggered the change, or events with no schema mutation (e.g. data exports, login failures). The audit UI (#18) needs a unified `audit_log` table regardless of backend.
**Background:** Temporal tables are kept — they provide point-in-time row reconstruction which is valuable. The `audit_log` table is additive, capturing the user-context events that temporal tables miss.
**Acceptance criteria:**
- `audit_log` table added to the SQL Server core schema (same columns as the Postgres version: id, table_name, record_id, action, changed_by, changed_at, old_data NVARCHAR(MAX) as JSON, new_data NVARCHAR(MAX) as JSON)
- Application-level events (login success/failure, data exports, query runs) write to `audit_log` explicitly
- Schema changes to core tables still tracked via temporal tables; `audit_log` is not a replacement
- `GET /api/audit` reads from `audit_log` on both backends — same response shape

---

#### #78 — Setup wizard: database type picker and backend-specific config
**Size:** M
**Persona:** System admin
**Problem:** The setup wizard hard-codes SQL Server. A System Admin installing on PostgreSQL has no supported path.
**Background:** This ticket wires the new backends (#76, #77) into the setup wizard UI designed in #73. Three setup paths:
1. **SQL Server** — host, port, database, username, password, ODBC driver (existing flow)
2. **PostgreSQL — existing database** — host, port, database, username, password
3. **PostgreSQL — create new database** — host, port, superuser username, superuser password → admin-it runs `CREATE DATABASE`, creates a restricted app user, then proceeds with schema deployment using those app credentials
**Acceptance criteria:**
- Setup step 1 presents a database type selector (SQL Server / PostgreSQL)
- SQL Server path: existing form fields, no change in behaviour
- PostgreSQL existing path: host/port/database/user/password; tests connection with `psycopg2` before saving
- PostgreSQL create-new path: host/port/superuser credentials; admin-it creates the database and a restricted `adminit_app` user with least-privilege grants; superuser credentials are not stored after setup completes
- Selected backend type stored in encrypted core config alongside connection details
- `CORE_DB_TYPE` set accordingly at startup
- All three paths deploy the appropriate schema on success

---

#### #79 — Detect existing install — connect-only mode ✅ done
**Size:** S
**Persona:** System admin
**Problem:** The setup wizard currently assumes a fresh install and always attempts to deploy the schema. If admin-it has already been installed on this database server — or if the admin-it schema objects already exist from a previous install — the wizard will either fail or overwrite existing data.
**Acceptance criteria:**
- After a successful connection test, the wizard queries the database to check whether the admin-it schema and core tables already exist
- If detected: wizard presents two options — "Connect to existing install" (skip schema deployment, proceed to login) or "Re-deploy schema" (for disaster recovery — requires explicit confirmation and warns that existing data may be affected)
- If not detected: existing fresh-deploy flow proceeds as normal
- "Connect to existing" path: validates that a SystemAdmin user exists in the detected schema; if not, falls back to the create-admin step
- Works for both SQL Server and PostgreSQL backends

---

#### #88 — Auto-detect ODBC driver; fix SSL connection string brace-wrapping ✅ done
**Size:** S
**Persona:** System admin
**Problem:** Schema deployment via sysadmin path failed with an SSL certificate error. Root cause: `_deploy_via_sysadmin` brace-wrapped the `SERVER` and `DATABASE` fields in the ODBC connection string. ODBC drivers only expect braces around `UID`/`PWD` values — bracing `SERVER={hostname}` caused the driver to misparse the string, silently ignoring `TrustServerCertificate=yes`.
**Fix:** Remove braces from `SERVER` and `DATABASE`. Auto-detect the best available ODBC driver on the backend (`_best_odbc_driver()`: prefers Driver 18, falls back to 17) rather than accepting it from the client. Removed the ODBC driver selector from the setup UI entirely. Added "Test sysadmin connection" button to the MSSQL create-new form.

---

#### #86 — Deploy MSSQL schema as sysadmin; save app-login config after deploy ✅ done
**Size:** M
**Persona:** System admin
**Problem:** Schema deployment ran as the restricted `adminit_app` login, which lacked the privileges to create foreign keys (`REFERENCES` permission denied). A failed deploy also left the system in a half-configured state (config saved, schema not deployed) with no clean recovery path.
**Fix:** New `POST /api/setup/deploy-schema` body path accepts sysadmin credentials (only pre-config-save; 403 once setup is complete). Schema deployed with sysadmin privileges. App-login config saved only after schema deploy succeeds. `create-mssql-db` and `create-postgres-db` gate on `_is_setup_fully_complete()` instead of `core_config_exists()` so partial setup never blocks recovery.

---

#### #85 — Three-step setup check in routing guards ✅ done
**Size:** S
**Persona:** System admin
**Problem:** `HomeLoader` and `ProtectedSetupRoute` treated `configured=true` as fully done, redirecting to `/login` even when schema wasn't deployed yet. User was locked out mid-setup.
**Fix:** Shared `isSetupComplete()` helper checks all three steps (config saved + schema deployed + admin user present). Both routing guards use it.

---

#### #84 — Grant REFERENCES on schema to app login ✅ done
**Size:** S
**Persona:** System admin
**Problem:** `CREATE FOREIGN KEY` failed during schema deployment — the app login lacked `REFERENCES` permission.
**Fix:** Added `GRANT REFERENCES ON SCHEMA::{schema} TO {login}` in `create_mssql_db`.

---

#### #83 — Resume setup without auth when schema/admin not yet deployed ✅ done
**Size:** S
**Persona:** System admin
**Problem:** Setup wizard redirected to `/login` instead of the correct setup step when config was saved but schema/admin wasn't yet deployed.
**Fix:** `determineStep()` checks deploy and admin status before requiring a token. Steps 2 and 3 reachable without authentication during first-time setup.

---

#### #82 — Fix: CREATE TRIGGER must be first statement in its batch ✅ done
**Size:** S
**Persona:** System admin
**Problem:** Schema deployment fails on SQL Server with `'CREATE TRIGGER' must be the first statement in a query batch`. All DDL was appended to a single `@sql` variable and executed in one `sp_executesql` call — the `DROP TRIGGER` preceding each `CREATE TRIGGER` meant `CREATE TRIGGER` was never first in its batch.
**Fix:** Split trigger deployment: `EXEC sp_executesql @sql` now runs before the trigger section. Each trigger is then executed in two separate `sp_executesql @trig` calls — one for the `DROP IF EXISTS`, one for the `CREATE TRIGGER` — so each `CREATE TRIGGER` is the first (and only) statement in its own sub-batch. Tables, seed data, and audit_log remain in the original single-batch approach.

---

#### #81 — Setup wizard: SQL Server create-new — support existing login ✅ done
**Size:** S
**Persona:** System admin
**Problem:** The "Create new database" path always attempts to create a new SQL login. A System Admin who has already created a dedicated app login on the server cannot reuse it — they are forced to create a duplicate or delete and recreate.
**Background:** Extends #80. A simple `create_login` boolean on the backend request skips the `CREATE LOGIN` step when `False`. The DB user and schema/grant steps still run, so the login gets the correct permissions on the newly-created database regardless. The frontend adds a checkbox "Create this login (uncheck if it already exists on the server)", checked by default.
**Acceptance criteria:**
- `POST /api/setup/create-mssql-db` accepts `create_login: bool` (default `true`); when `false`, the `CREATE LOGIN` step is skipped
- DB user creation and schema grants still run unconditionally
- Frontend checkbox in the SQL Server create-new form; checked by default; unchecking sends `create_login: false`

---

#### #80 — Setup wizard: SQL Server create-new database path ✅ done
**Size:** M
**Persona:** System admin
**Problem:** The SQL Server setup path requires the user to provide an existing database. A System Admin with a fresh SQL Server instance — no user databases, only system databases — has no way to complete setup without first manually creating a database outside of admin-it. This is a dead end with no guidance.
**Background:** The PostgreSQL path (#78) already supports a "create new database" flow: the user provides superuser credentials, admin-it creates the database and a restricted app user, then deploys the schema. The SQL Server path needs the same option. The key differences: SQL Server uses `CREATE DATABASE` (no template), login/user creation uses `CREATE LOGIN` / `CREATE USER`, and least-privilege grants use `GRANT` on the schema rather than `ALTER DEFAULT PRIVILEGES`.
**Acceptance criteria:**
- Step 1 of the setup wizard gains a pgMode-style toggle for SQL Server: **"Use existing database"** (current behaviour) and **"Create new database"**
- Create-new form fields: database name, schema name (default `adm`), sysadmin username, sysadmin password, app username (default `adminit_app`), app user password
- Backend `POST /api/setup/create-mssql-db` endpoint: connects with sysadmin credentials, creates the database, creates a contained login scoped to that database, grants least-privilege (SELECT, INSERT, UPDATE, DELETE on schema; CREATE TABLE for schema deployment); sysadmin credentials are not stored after the call completes
- All identifiers (database name, schema name, usernames) validated against an allowlist regex before use in DDL — no user-controlled strings interpolated without validation
- On success, the connection details (host, port, database, app username, app password) are returned to the frontend and used for the save/continue flow, matching the PostgreSQL create-new pattern
- "Discover" button in existing-database mode correctly handles a blank server (no user databases) by showing a clear message: "No databases found. You can create a new one using the 'Create new database' option."
- Works with both ODBC Driver 17 and ODBC Driver 18 for SQL Server

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
- **MySQL / Oracle / other database vendors for target connections** — SQL Server only for browsing target databases, initially. The admin-it core schema runs on SQL Server or PostgreSQL (Phase 2.5), but the data browser (Phase 3+) targets SQL Server connections only.
- **SQLite as a core backend** — SQLite has no concurrent write support, no schema namespacing, and no viable session-variable mechanism for audit triggers. It is not a suitable backend for a multi-user application. PostgreSQL covers the "free, no licence required" use case cleanly.
- **Docker-managed PostgreSQL** — admin-it will not spin up or manage its own Postgres container. The System Admin is responsible for providing a Postgres server (self-hosted or cloud-managed). This keeps admin-it's operational surface area small.
- **A general SQL IDE** — We are not building SSMS in the browser. Power users can use saved queries; raw SQL execution is not a first-class feature for end users.
- **Row-level security on target databases** — Column masking (#15) is the extent of data restriction admin-it enforces. Row-level filtering based on the logged-in user's identity is not in scope.

---

## Immediate next actions (in order)

Phase 1 hardening complete. Phase 2 (connection and user management) done. Phase 1.5 (frontend overhaul) done. Phase 2.5 setup wizard multi-database support done (#75–#82, #83–#86, #88 done). Phase 3 data browser started: #12 (table browser — schemas, tables, columns) done. Setup wizard is fully working end-to-end for both SQL Server (create-new and existing) and PostgreSQL. First-time setup has been successfully completed. Remaining work in priority order:

1. **Phase 3 (data browser)** — continue with #13 (paginated row view with column filtering)
2. **Auth UX improvement** — email as primary login identifier; username as display name only (open ticket)
