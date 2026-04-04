# Saved Query Library — Design Spec (#16)

**Date:** 2026-03-31
**Ticket:** #16
**Phase:** 4 — Saved queries & basic reporting
**Status:** Approved for implementation

---

## Overview

Power Users and Admins create parameterised SQL queries stored in the admin-it schema. All authenticated users with access to the query's connection can run those queries via a generated form — without ever seeing the SQL. Results render in the same data grid used by the data browser, with column masking and export mechanics reused from the data browser where applicable.

Future: the SQL textarea will eventually gain SQL intellisense / autocomplete (deferred to a later ticket).

---

## Role changes required by this ticket

The `PowerUser` role is referenced throughout this spec. It does not currently exist as a seeded role in either deploy script. This ticket must add it:

- **`spDeployCoreSchema.sql`**: seed `Admin`, `EndUser`, and `PowerUser` roles. Currently only `SystemAdmin` is seeded in this file — `Admin` and `EndUser` are missing, which is a pre-existing bug. This ticket fixes all three gaps in one pass. The PostgreSQL script already seeds `SystemAdmin`, `Admin`, and `EndUser` — only `PowerUser` needs to be added there.
- **`deploy_core_schema_postgres.sql`**: add `PowerUser` seed row (alongside the existing `SystemAdmin`, `Admin`, `EndUser` rows)
- **`users_routes.py`**: add `"PowerUser"` to the `RoleName` Literal type and `ROLE_PRECEDENCE` dict (between `EndUser: 1` and `Admin: 2`, e.g. `"PowerUser": 1.5` or renumber)

Role hierarchy (ascending privilege): `EndUser` < `PowerUser` < `Admin` < `SystemAdmin`

**"Admin+ bypass" definition:** Throughout this spec, "Admin+ bypass" means the caller's roles contain `"Admin"` or `"SystemAdmin"`. `PowerUser` is NOT in the bypass set. `ADMIN_ROLES = {"Admin", "SystemAdmin"}` is currently defined independently in `browse_routes.py`, `data_routes.py`, and `connections_routes.py`. As part of this ticket, move the constant to `app/utils/auth_dependency.py` and import it in all existing routes and in the new `query_routes.py`. This creates a single source of truth and prevents future drift when roles change.

**Ownership model:** any PowerUser with `UserConnectionAccess` to a connection can edit any query on that connection, regardless of who created it. There is no per-query ownership check — access is connection-scoped.

---

## Database Schema

Two new tables added to both `spDeployCoreSchema.sql` (SQL Server) and `deploy_core_schema_postgres.sql`.

**PostgreSQL note:** where SQL Server uses `SYSUTCDATETIME()`, the PostgreSQL script uses `NOW() AT TIME ZONE 'UTC'`. All date defaults must be adapted per-script.

**PostgreSQL audit constraint note:** `deploy_core_schema_postgres.sql` currently only allows `'INSERT', 'UPDATE', 'DELETE'` in the `audit_log` CHECK constraint. This ticket must extend it to also allow `'ACCESS'` and `'EXPORT'`. The SQL Server `chk_audit_log_action` already includes both values.

**`log_export_audit` migration:** The existing `log_export_audit` helper currently uses `action='INSERT'` as a workaround because the PostgreSQL constraint did not allow `'EXPORT'`. Once the constraint is fixed by this ticket, `log_export_audit` must be updated to use `action='EXPORT'` (bringing it in line with its stated purpose and `log_masked_access_audit` which already uses `action='ACCESS'`). The new query audit helpers added in this ticket use `action='ACCESS'` (run) and `action='EXPORT'` (export) directly — no workaround.

### `SavedQueries`

| Column | Type | Notes |
|---|---|---|
| `SavedQueryId` | UNIQUEIDENTIFIER PK | `DEFAULT NEWID()` |
| `ConnectionId` | UNIQUEIDENTIFIER FK | → `Connections(ConnectionId) ON DELETE NO ACTION` |
| `Name` | NVARCHAR(255) NOT NULL | |
| `Description` | NVARCHAR(1000) NULL | |
| `QueryText` | NVARCHAR(MAX) NOT NULL | Raw SQL — SELECT only (enforced at run time) |
| `IsActive` | BIT NOT NULL | `DEFAULT 1` |
| `CreatedById` | UNIQUEIDENTIFIER FK | → `Users(UserId) ON DELETE NO ACTION` |
| `CreatedDate` | DATETIME2 NOT NULL | `DEFAULT SYSUTCDATETIME()` |
| `ModifiedById` | UNIQUEIDENTIFIER FK | → `Users(UserId) ON DELETE NO ACTION` |
| `ModifiedDate` | DATETIME2 NOT NULL | `DEFAULT SYSUTCDATETIME()` |

**Constraints:**
- `UNIQUE (ConnectionId, Name)` — no duplicate query names per connection. This constraint applies across both active and soft-deleted rows, meaning a deleted query permanently reserves its name on that connection. This is intentional — name reuse after deletion is not supported in this version.

**Audit trigger:** `trg_audit_SavedQueries` — same pattern as existing tables, writes to `audit_log`.

---

### `QueryParameters`

| Column | Type | Notes |
|---|---|---|
| `ParameterId` | UNIQUEIDENTIFIER PK | `DEFAULT NEWID()` |
| `SavedQueryId` | UNIQUEIDENTIFIER FK | → `SavedQueries(SavedQueryId) ON DELETE NO ACTION` |
| `Name` | NVARCHAR(100) NOT NULL | Matches `:name` placeholder in SQL |
| `Label` | NVARCHAR(255) NOT NULL | Display label shown to end users |
| `ParamType` | NVARCHAR(20) NOT NULL | `text \| number \| date \| boolean \| select` |
| `IsRequired` | BIT NOT NULL | `DEFAULT 1` |
| `DefaultValue` | NVARCHAR(500) NULL | |
| `SelectOptions` | NVARCHAR(MAX) NULL | JSON array of strings; only used when `ParamType = 'select'`; max 200 options, each max 500 chars |
| `DisplayOrder` | INT NOT NULL | `DEFAULT 0` — controls form field order |

**Constraints:**
- `UNIQUE (SavedQueryId, Name)` — no duplicate parameter names per query

`QueryParameters` rows are owned by their parent query. No independent audit trigger — query-level audit captures the intent.

The FK uses `ON DELETE NO ACTION` (consistent with all other FKs in this schema) rather than `CASCADE`, because `SavedQueries` is soft-deleted — the parent row is never physically removed. PATCH hard-deletes and re-inserts `QueryParameters` rows directly (not via parent row deletion), so `ON DELETE NO ACTION` vs `CASCADE` is irrelevant to that operation.

**Known tradeoff:** PATCH replaces all parameters (delete + re-insert). Old `ParameterId` UUIDs are permanently removed. Any past `audit_log` rows referencing those `ParameterId` values will have no corresponding live row. This is acceptable because audit intent is captured at the `SavedQuery` level; parameter-level history is not required for this version.

---

## API

New router: `backend/app/routes/query_routes.py`, registered at `/api/queries`.

### Pydantic Models

```python
class QueryParameterIn(BaseModel):
    name: str = Field(..., pattern=r'^[a-zA-Z_][a-zA-Z0-9_]*$', max_length=100)
    label: str = Field(..., max_length=255)
    param_type: Literal["text", "number", "date", "boolean", "select"]
    is_required: bool = True
    default_value: str | None = Field(default=None, max_length=500)
    select_options: list[str] | None = None   # required (non-empty) when param_type == "select"; max 200 items, each max 500 chars
    display_order: int = 0

class QueryIn(BaseModel):
    connection_id: str = Field(..., pattern=r'^[0-9a-fA-F\-]{36}$')  # UUID format validated → 422
    name: str = Field(..., min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=1000)
    query_text: str = Field(..., min_length=1)  # must be non-empty; no server-side length cap (NVARCHAR(MAX))
    parameters: list[QueryParameterIn] = []

class QueryPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=1000)
    query_text: str | None = Field(default=None, min_length=1)
    parameters: list[QueryParameterIn] | None = None   # full replacement when provided
    # connection_id is intentionally not patchable
    # Nullable fields: sending `"description": null` explicitly clears the field (sets to NULL in DB).
    # Omitting a field entirely leaves it unchanged.
    # Implementation must use model.__fields_set__ (Pydantic v1) to distinguish null-sent from omitted.
    # For non-nullable fields (name, query_text), null is rejected by Field(min_length=1).

class RunRequest(BaseModel):
    # All parameter values are strings. The frontend always serialises to strings —
    # booleans sent as "true"/"false", numbers as "42.5", dates as "2024-01-31".
    # JSON booleans (true/false without quotes) are rejected at deserialisation.
    # dict size is not explicitly capped — unknown keys are silently dropped before execution,
    # so oversized dicts are harmless. Rate limiting / timeout hardening is deferred.
    parameters: dict[str, str] = {}
    page: int = Field(default=1, ge=1)
    page_size: int = Field(default=50, ge=1, le=200)   # capped at 200, matching data browser

class ExportRequest(BaseModel):
    parameters: dict[str, str] = {}
    format: Literal["csv", "xlsx"] = "csv"
```

### Parameter Validation Rules (shared by POST and PATCH)

These rules apply whenever `parameters` is provided (both create and full-replacement update):

1. All `parameter.name` values match `^[a-zA-Z_][a-zA-Z0-9_]*$` (enforced via Pydantic `Field(pattern=...)`)
2. `select_options` is present and non-empty when `param_type == "select"`; each option max 500 chars; max 200 options
3. `display_order` values: the frontend maps list index → `display_order` integer (0-based) before submit; ties broken by insertion order (ParameterId). When fetching params for execution, sort by `DisplayOrder ASC, ParameterId ASC` for determinism.
4. `select_options` items are matched case-sensitively at run time (exact string match)
5. `select_options` must be `NULL` (or absent) when `param_type != 'select'` — if a caller sends `select_options` for a non-select type, return 422

### Endpoints

#### `POST /api/queries`
- **Auth:** PowerUser or Admin role required; calling user must have `UserConnectionAccess` to the specified `connection_id` (row existence sufficient; Admin+ bypass applies)
- Creates a saved query and its parameters atomically (transaction)
- Validates `connection_id` exists and is active
- Applies Parameter Validation Rules (above)
- Returns `201` with the created query (including parameters), `query_text` included
- Returns `409` if `(ConnectionId, Name)` already exists

#### `GET /api/queries`
- **Auth:** Any authenticated user
- Optional query param: `?connection_id=<uuid>` — if provided, must be a valid UUID format (validated via `Query(pattern=r'^[0-9a-fA-F\-]{36}$')`, returns 422 on invalid format)
- Returns active queries. Response is an array of objects with fields:
  - `saved_query_id`, `connection_id`, `connection_name`, `name`, `description`, `created_by_username`, `created_date`, `modified_date`
  - `query_text` — included for PowerUser+; the field is **absent** (not present in the JSON object, not `null`) for EndUser
  - `parameters` — array of parameter objects (always included, used to render the run form)
- Only returns queries whose `ConnectionId` the calling user has access to (via `UserConnectionAccess`). Admin and SystemAdmin roles bypass the `UserConnectionAccess` check and see all active queries.
- Default sort: `Name ASC`
- Implementation note: build the response as a plain `dict` with `query_text` conditionally included (not via a Pydantic response model with `exclude_none`, which would emit `null` instead of omitting the field). This ensures the field is truly absent in the JSON for EndUsers, not `null`.

#### `GET /api/queries/{id}`
- **Auth:** Any authenticated user
- Returns 404 if the query does not exist or is soft-deleted (inactive)
- Returns 403 if the calling user has no access to the query's connection (Admin+ bypass applies) — consistent with `_require_connection_access` pattern used in all existing target-connection routes
- Returns query + parameters for accessible queries
- PowerUser+: includes `query_text`; EndUser: `query_text` field absent from the JSON response (not null, not present)

#### `PATCH /api/queries/{id}`
- **Auth:** PowerUser or Admin role required
- Returns 404 if the query does not exist or is soft-deleted
- **Pre-flight:** fetch the query's stored `ConnectionId`. If the calling user has no `UserConnectionAccess` row for that connection (Admin+ bypass applies), return 403 — consistent with `_require_connection_access` in existing routes.
- If the connection itself is now inactive (soft-deleted after the query was created), the PATCH still proceeds — the operation is on the query row, not the connection.
- If `model.__fields_set__` is empty (nothing was sent at all) → `400 Bad Request` (no-op PATCH). Sending `description: null` is a valid mutation (clears the description) and must not trigger the 400.
- Partial update. If `parameters` is provided, replaces all parameters (delete + re-insert in transaction), applying Parameter Validation Rules.
- Updates `ModifiedById` and `ModifiedDate` on any successful mutation.
- Returns updated query (same shape as `GET /api/queries/{id}` for PowerUser+)

#### `DELETE /api/queries/{id}`
- **Auth:** Admin or SystemAdmin only
- Admin role bypasses `UserConnectionAccess` for this operation — any Admin can soft-delete any query
- Returns 404 if query does not exist or is already inactive
- Soft delete: sets `IsActive = 0`, `ModifiedById = calling_user_id`, `ModifiedDate = now()`
- Returns `204`

#### `POST /api/queries/{id}/run`
- **Auth:** Any authenticated user
- **Checks (in order):**
  1. Query exists and is active — 404 otherwise
  2. Calling user has `UserConnectionAccess` to the query's connection (Admin+ bypass) — 403 otherwise (consistent with `_require_connection_access` in existing routes)
  3. All required parameters are present — 422 otherwise
  4. Each value coerces to its declared type — 422 with field-level errors otherwise
  5. Unknown keys in `parameters` dict (no matching `QueryParameter.Name`) are silently ignored and never forwarded to the SQL engine. Only declared parameter names are bound.
  6. `QueryText` stripped of leading/trailing whitespace: must start with `SELECT` (case-insensitive, after stripping) **and must not contain a semicolon** anywhere in the text — 422 otherwise. CTE queries (starting with `WITH`) are not supported in this version — a `WITH`-prefixed `QueryText` will be rejected by the `SELECT`-first check, so the editor must surface this clearly (see frontend).

  **Security boundary note:** The `SELECT`-only and no-semicolon checks are defence-in-depth against accidental misuse only. A determined PowerUser can craft a query that injects into the CTE wrapper. The actual security control is restricting write access to PowerUser+ roles. The implementation must include a code comment at the run endpoint:
  ```python
  # SELECT/semicolon check is defence-in-depth only.
  # Trust boundary is enforced at create/edit (PowerUser+ role required).
  ```
- **Execution mechanism:** uses raw `pyodbc` via `_open_target(creds)`, consistent with `data_routes.py` and `browse_routes.py`. pyodbc uses positional `?` placeholders, not named `:param` syntax. The `:name` syntax in the stored `QueryText` is the **author-facing** parameter syntax — it is rewritten to `?` before execution:
  1. Apply the rewrite regex to `QueryText` using a **single left-to-right pass** that finds each `:param_name` token and replaces it with `?`. Use Python regex `re.sub(r':([a-zA-Z_][a-zA-Z0-9_]*)(?![a-zA-Z0-9_])', '?', query_text)` (negative lookahead prevents partial-name clobbering, e.g. `:user_id` must not match inside `:user_id_ext`). Capture the token names in the order they appear in the SQL text.
  2. Build the positional value list in that same **text-order** (left-to-right occurrence order in the SQL), not `DisplayOrder` order. `DisplayOrder` governs only frontend form rendering.
  3. Apply cursor timeout: `cursor.timeout = TARGET_QUERY_TIMEOUT_SECONDS` (same as data browser)
  4. The final executed SQL is the subquery wrapper (below) with the rewritten SQL substituted in

  **Known limitation of `:name` rewrite:** the regex operates on the full SQL text including string literals. A literal like `WHERE status = ':active'` would incorrectly rewrite `:active` to `?`. This is a known limitation — the query editor must warn the user if `:name`-shaped tokens appear inside string literals. Server-side detection is out of scope for this version.

- **Pagination strategy:** wrap the stored query as a subquery (using a collision-resistant alias):
  ```sql
  -- count query (SQL Server — same for both backends via pyodbc)
  SELECT COUNT(*) FROM (<positional_sql>) AS __sq_wrap__

  -- page query (SQL Server)
  SELECT * FROM (<positional_sql>) AS __sq_wrap__
  ORDER BY (SELECT NULL)
  OFFSET ? ROWS FETCH NEXT ? ROWS ONLY

  -- page query (PostgreSQL)
  SELECT * FROM (<positional_sql>) AS __sq_wrap__
  LIMIT ? OFFSET ?
  ```
  The positional `?` values for OFFSET and FETCH/LIMIT are appended to the parameter value list after the query's own parameters.

  Using a subquery wrapper (not a CTE) avoids nested-CTE problems. `WITH`-prefixed queries are also rejected by the SELECT-first check, so this is belt-and-suspenders.
- **Column masking:** call `load_masks_for_connection(backend, connection_id)` — a new helper that returns the set of lowercase column names masked across all tables for that connection. On failure, this helper must **re-raise** (not swallow), consistent with `load_masks()` — failing open would silently serve unmasked data.
  - **Non-Admin+ (EndUser, PowerUser):** replace masked column values with `"****"`. The column is still included in the response (same as data browser browse behaviour). `masked_columns` in the response lists the **original-case** column names that were masked.
  - **Admin+ users:** see real values. If masked columns are present, call `log_masked_access_audit` with `schema_name="SavedQuery"`, `table_name=<query_name>` as context (best-effort, swallow on failure).
- **Response shape:**
  ```json
  {
    "columns": ["col1", "col2", ...],   // ordered list of column names from the result set
    "rows": [{"col1": "val", ...}, ...],
    "masked_columns": ["SSN", ...],     // original-case column names that were masked (consistent with data browser)
    "total_count": 1234,
    "page": 1,
    "page_size": 50,
    "total_pages": 25
  }
  ```
- **Masked column access audit:** if the calling user is Admin+ and any result columns were masked, call `log_masked_access_audit` with `connection_id`, `schema_name="SavedQuery"`, `table_name=<query_name>`, `masked_columns=<sorted lowercase names>`. Best-effort — swallow on failure. Only on page 1.
- **Audit failure handling:** audit writes are best-effort — swallow exceptions and log, do not re-raise. A failed audit write must never block a legitimate read response. (This applies only to audit writes, not to the masking load — masking failures re-raise.)
- Logs to `audit_log` on **page 1 only** (`page == 1`): `table_name='SavedQueries'`, `action='ACCESS'`, `record_id=SavedQueryId`, `changed_by=calling_user_id`, `new_data=NULL`, `old_data=NULL`. Subsequent page fetches are not logged to avoid excessive audit volume.

#### `POST /api/queries/{id}/export`
- Same validation and execution as `/run` (same SELECT + semicolon check, same subquery wrapping, same connection-access check, same unknown-key handling, same masking failure-mode — re-raise on `load_masks_for_connection` failure)
- **Column masking for export:** non-Admin+ users have masked columns **excluded entirely** from the export (same as data browser export behaviour — not `"****"`). Admin+ users receive all columns including masked values, and `log_masked_access_audit` is called.
- Request body: `ExportRequest` (see Pydantic models above)
- Max 10,000 rows. When the result set exceeds 10,000 rows, silently truncate to 10,000 and include `X-Export-Truncated: true` response header (same pattern as data browser export)
- Export filename derived from query name: sanitised to alphanumeric, dash, underscore (same regex as data browser export)
- Returns file response with appropriate Content-Type
- Audit: `table_name='SavedQueries'`, `action='EXPORT'`, `record_id=SavedQueryId`, `changed_by=calling_user_id`, `new_data=NULL`, `old_data=NULL` — best-effort, swallow on failure

### Parameter Type Coercion

Server-side, before execution, each raw string value is coerced:

| Type | Coercion | Bind param Python type |
|---|---|---|
| `text` | stripped string | `str` |
| `number` | `float(value)` — 422 if not numeric | `float` |
| `date` | `datetime.date.fromisoformat(value)` — 422 if invalid | `datetime.date` |
| `boolean` | `"true"/"1"/"yes"` → `True`, `"false"/"0"/"no"` → `False` (case-insensitive) — 422 otherwise | `bool` |
| `select` | must be in `select_options` list (exact string match, case-sensitive) — 422 otherwise; if `select_options` is `NULL` in the DB (data integrity issue), return 500 | `str` |

---

## Column Masking Strategy

The data browser's `load_masks(backend, connection_id, schema_name, table_name)` is scoped to a single table. Saved query results are multi-table, so a new helper is required:

```python
def load_masks_for_connection(backend, connection_id: str) -> set[str]:
    """
    Returns the set of lowercase column names that are masked for any
    table on this connection. Applied by column name alone — schema/table
    context is unavailable for arbitrary query results.

    Raises on failure (does NOT return an empty set on error) — consistent
    with load_masks(). Failing open would silently serve unmasked data.
    """
```

This is a broader mask — any column named `ssn` anywhere on the connection will be masked in query results, even if it comes from a table that wasn't individually configured. This is a conservative choice: better to over-mask than under-mask. The behaviour is surfaced in the UI (info note in the run panel: "Column masking is applied by column name across all tables on this connection").

`masked_columns` in the run response contains **original-case** column names (the names as returned by pyodbc from the result set), not the lowercase set from the helper. Match using `col_name.lower() in masked_cols_lower` to identify which columns to mask, then include `col_name` (original case) in the `masked_columns` list — consistent with `data_routes.py` line 370.

---

## Frontend

### Route

`/queries` — added to `App.jsx` wrapped in `<RequireAuth><AppShell>`.

Sidebar entry added: "Saved Queries" under the data section.

### `SavedQueriesPage.jsx`

List view — mirrors `ConnectionsPage` layout:

- Table columns: Name, Connection, Description, Created by, actions
- **Run** button on every row (all users)
- **Edit** button (PowerUser+ only)
- **Delete** button (Admin+ only)
- Empty state when no queries exist
- Filter/search by connection (dropdown) above the table

### Query Editor Modal (PowerUser+)

Opened on "New Query" or "Edit":

- **Connection** — dropdown of accessible connections
- **Name** — text input (1–255 chars)
- **Description** — optional textarea (max 1000 chars)
- **SQL** — plain `<textarea>` (no syntax highlighting in v1; intellisense deferred to a future ticket)
  - Note below the textarea: "CTE queries (starting with `WITH`) are not supported. Use a plain `SELECT` statement."
- **Parameters** — dynamic list:
  - Each row: Name, Label, Type, Required toggle, Default value, Options (shown only when type = `select`, comma-separated input split into an array on save; each option max 500 chars)
  - Add/remove rows
  - Row position determines `display_order` — the frontend maps index → integer (0-based) before submit
- **Validation before submit:**
  - A `:name` placeholder in the SQL with no matching parameter row → **blocking error** (user cannot save — the query would fail at run time with an unbound parameter)
  - A parameter row whose `name` does not appear in the SQL as a `:name` placeholder → **inline warning only, non-blocking** (allowed — the param may be intentionally optional or the SQL is still being written)
  - `:name` placeholders extracted via regex `/:([a-zA-Z_][a-zA-Z0-9_]*)/g`. Note: this regex matches `:name` inside SQL string literals (e.g. `':prefix'`) — this is a known limitation of client-side detection; the developer may choose to document rather than fix it
- On save: `POST /api/queries` or `PATCH /api/queries/{id}`

### Run Panel Modal (all users)

Opened on "Run":

- Shows query name and description
- Renders a generated form from parameter schema (ordered by `display_order`):
  - `text` → `<Input>`
  - `number` → `<Input type="number">`
  - `date` → `<Input type="date">`
  - `boolean` → checkbox (serialise via `checked ? "true" : "false"` — must use `e.target.checked`, not `e.target.value`, to get the JS boolean before string conversion)
  - `select` → `<select>` dropdown with `select_options` as `<option>` values
- Required fields marked; default values pre-filled
- All values serialised to strings before sending
- **Run** button → `POST /api/queries/{id}/run`
- Results in data grid (same component as data browser — paginated, sortable)
- **Export** button → CSV or XLSX via `POST /api/queries/{id}/export`
- SQL text **not shown** to EndUsers; not returned by the API for their role
- Info note near results: "Column masking is applied by column name across all tables on this connection"

---

## Security Model

| Concern | Approach |
|---|---|
| Authentication | All endpoints require valid JWT via `Depends(verify_token)` |
| Create/edit | PowerUser or Admin role + `UserConnectionAccess` (row existence) — 403 otherwise |
| Edit connection-access check | Pre-flight read of stored `ConnectionId`; verify `UserConnectionAccess`; return **403** if denied (consistent with `_require_connection_access` in existing routes) |
| Delete | Admin or SystemAdmin only; Admin bypasses `UserConnectionAccess` for soft-delete |
| Run/read | Any authenticated user, gated on `UserConnectionAccess` (Admin+ bypass); **403** on access failure (consistent with existing routes) |
| SQL injection (values) | All parameter values passed as positional pyodbc `?` bind params — never interpolated |
| SQL injection (identifiers) | Query text has no identifier interpolation — stored and executed as-is |
| SELECT enforcement | On every run/export: stripped query must start with `SELECT` AND must not contain a semicolon; CTE (`WITH`) queries rejected |
| SELECT enforcement scope | Defence-in-depth only. Trust boundary is the PowerUser+ role check on create/edit. Code comment required at run endpoint. |
| Query text visibility | `query_text` omitted from API responses for EndUser role |
| Column masking | Run results masked by column name via `load_masks_for_connection` — re-raises on failure (never fails open) |
| Masked column access audit | When an Admin+ user receives unmasked data via run/export, `log_masked_access_audit` is called (same as data browser). Best-effort — swallow on failure. |
| Audit failures | Best-effort for all audit writes — swallowed, never propagated as 500 errors |
| Audit | Run (page 1 only) and export logged to `audit_log` |

---

## Out of Scope (this ticket)

- SQL intellisense / autocomplete in the editor (future ticket)
- CTE query support (deferred — requires a more sophisticated validation approach)
- Query scheduling / email delivery (ticket #17)
- Row-level security on query results
- Query versioning / history
- Query execution timeout / rate limiting (deferred — noted as future hardening)
- `UserConnectionAccess.IsActive` column check — consistent with existing data browser behaviour; deferred
