# Audit Log UI — Design Spec (#18)

**Date:** 2026-04-03  
**Ticket:** #18 — Audit log UI  
**Phase:** 5 — Audit & compliance  
**Status:** Design approved, pending implementation

---

## Overview

The audit log is an investigation tool. Admins use it to answer questions like:
- "Something changed between Tuesday and Thursday — what was it and who did it?"
- "Show me every change ever made to this specific user account."
- "What has alice been doing this week?"

The UI must support both time-first investigation (narrow a date range, then drill in) and record-first investigation (click a record ID to see its full lifecycle). Filters compose and can be removed individually or cleared entirely.

---

## Scope

### In scope
- `GET /api/audit` — server-side pagination and filtering (extend existing endpoint)
- `GET /api/audit/users` — lightweight user list for the "User" filter dropdown (Admin only)
- `AuditLogPage` frontend component
- Sidebar nav item enabled (`implemented: true`)

### Out of scope
- Writing to the audit log from this ticket (triggers and application-level writes are already implemented)
- Export of audit log entries
- Audit log for login events (#19 — separate ticket)

---

## Backend

### Extend `GET /api/audit`

Replace the current no-param, TOP 1000 implementation with server-side pagination and filtering.

**Query parameters:**

| Param | Type | Default | Description |
|---|---|---|---|
| `page` | int | 1 | 1-based page number |
| `page_size` | int | 50 | Rows per page (max 200) |
| `table_name` | str \| None | None | Filter by exact table name |
| `action` | `Literal['INSERT','UPDATE','DELETE','ACCESS','EXPORT']` \| None | None | Filter by action type; invalid values return 422 |
| `changed_by` | UUID \| None | None | Filter by user UUID |
| `record_id` | UUID \| None | None | Filter by record UUID — when set, no date restriction is applied (see default behaviour below) |
| `from_dt` | datetime \| None | None | Lower bound on `changed_at` (inclusive) |
| `to_dt` | datetime \| None | None | Upper bound on `changed_at` (inclusive) |

Pydantic will validate `changed_by` and `record_id` as `Optional[UUID]` in the query params, returning a 422 automatically on malformed UUID input. No manual UUID validation is needed.

**Default behaviour:** The backend applies a 24-hour default window only when none of `record_id`, `from_dt`, or `to_dt` are provided. Concretely: `if record_id is None and from_dt is None and to_dt is None: from_dt = datetime.utcnow() - timedelta(hours=24)`. When `record_id` is set, no date filter is applied so the full record lifecycle is returned.

For the `7d` and `30d` quick presets the frontend must compute and send explicit `from_dt`/`to_dt` values (e.g. `from_dt = now - 7 days`, `to_dt = now`). Only the `24h` preset relies on the backend default (by sending no date params). This avoids the backend needing to understand preset semantics. Summary:

| Quick preset | What the frontend sends |
|---|---|
| `24h` | No `from_dt` / `to_dt` — backend applies 24h default |
| `7d` | `from_dt = T-7d T00:00:00`, `to_dt = now T23:59:59` |
| `30d` | `from_dt = T-30d T00:00:00`, `to_dt = now T23:59:59` |
| Custom range | `from_dt` and `to_dt` from the date inputs |
| Record ID mode | No date params; `record_id` set |

**Response shape:**

```json
{
  "entries": [
    {
      "id": "uuid",
      "table_name": "Users",
      "record_id": "uuid or null",
      "action": "UPDATE",
      "changed_by": "uuid or null",
      "changed_by_username": "alice or null",
      "changed_at": "2026-04-03T09:41:00",
      "old_data": [{ "Username": "alice", "Role": "EndUser" }],
      "new_data": [{ "Username": "alice", "Role": "Admin" }]
    }
  ],
  "total_count": 312,
  "page": 1,
  "page_size": 50,
  "total_pages": 7
}
```

**Error responses:**

| Status | Condition |
|---|---|
| 401 | Missing or invalid JWT |
| 403 | Authenticated user lacks Admin or SystemAdmin role |
| 422 | Malformed UUID in `changed_by` or `record_id` (Pydantic automatic) |
| 501 | Backend does not support audit log (raises `NotImplementedError`) |

**`changed_by_username` resolution:** resolved server-side via a `LEFT JOIN` on the Users table in the same query. Example join fragment (follow the existing bracket-quoting convention used throughout the codebase — `[schema].[TableName]` and `[ColumnName]`):

```sql
SELECT TOP (@page_size * @page) ...
    a.[id], a.[table_name], a.[record_id], a.[action],
    a.[changed_by], u.[Username] AS changed_by_username,
    a.[changed_at], a.[old_data], a.[new_data]
FROM [{schema}].[audit_log] a
LEFT JOIN [{schema}].[Users] u ON a.[changed_by] = u.[UserId]
WHERE 1=1
  -- conditional AND clauses appended for each active filter
ORDER BY a.[changed_at] DESC
```

All filter values passed as SQLAlchemy named bind parameters (`bindparam`). The schema name `{schema}` is safe to f-string interpolate (it comes from the encrypted config file, not user input — consistent with the documented pattern throughout the codebase).

### Update `CoreBackend` protocol and Postgres stub

`core_backend.py` declares `get_audit_records(self) -> list[dict]`. This signature must be updated to match the new implementation:

```python
def get_audit_records(
    self,
    page: int = 1,
    page_size: int = 50,
    table_name: str | None = None,
    action: Literal["INSERT", "UPDATE", "DELETE", "ACCESS", "EXPORT"] | None = None,
    changed_by: UUID | None = None,
    record_id: UUID | None = None,
    from_dt: datetime | None = None,
    to_dt: datetime | None = None,
) -> dict: ...
```

The route handler passes the `UUID` objects directly to the backend method. The backend converts them to strings via `str()` when building the SQL bind parameters. This keeps the type boundary clean — Pydantic validates at the HTTP layer, the backend serialises at the SQL layer.

The Postgres backend stub continues to raise `NotImplementedError` (unchanged behaviour, just updated signature).

### New `GET /api/audit/users`

New handler in `audit_routes.py` at `@router.get("/users")`. Returns the minimal user list for the filter dropdown. Requires Admin role — apply the same inline check used in the existing handler:

```python
if not ADMIN_ROLES.intersection(user.get("roles", [])):
    raise HTTPException(status_code=403, detail="Admin role required")
```

**Response:**

```json
[
  { "id": "uuid", "username": "alice" },
  { "id": "uuid", "username": "bob" }
]
```

SQL:

```sql
SELECT [UserId], [Username]
FROM [{schema}].[Users]
WHERE [IsActive] = 1
ORDER BY [Username]
```

**Error responses:** same as `GET /api/audit` (401, 403, 501).

---

## Frontend

### `AuditLogPage` (`frontend/src/pages/AuditLogPage.jsx`)

Single page component. State managed with `useReducer` (consistent with `UsersPage`, `ConnectionsPage`).

**State shape:**

```js
{
  status: 'loading' | 'loaded' | 'error',
  entries: [],
  totalCount: 0,
  page: 1,
  pageSize: 50,
  totalPages: 0,
  users: [],        // [{ id, username }] — for the User dropdown
  filters: {
    quickPreset: '24h',   // '24h' | '7d' | '30d' | 'custom' | null
    fromDate: null,       // 'YYYY-MM-DD' string from <input type="date"> or null
    toDate: null,         // 'YYYY-MM-DD' string from <input type="date"> or null
    tableName: null,
    action: null,
    changedBy: null,      // user UUID string
    recordId: null,       // full UUID string — when set, date filters are null
  },
  expandedRows: {},   // plain object: { [entryId]: true } — see note below
}
```

**Note on `expandedRows`:** use a plain object `{ [id]: true }` rather than a `Set`. This avoids the React `useReducer` pitfall where mutating a `Set` and returning `{ ...state }` does not trigger a re-render. Toggling a row: `return { ...state, expandedRows: { ...state.expandedRows, [id]: !state.expandedRows[id] } }`.

**Date handling:** `<input type="date">` yields `YYYY-MM-DD`. When sending to the backend, convert:
- `fromDate` → `fromDate + 'T00:00:00'` (start of day)
- `toDate` → `toDate + 'T23:59:59'` (end of day)

The backend stores `changed_at` as server-local time (no timezone awareness). The frontend sends local date boundaries without timezone conversion — this is consistent with how the rest of the app handles dates and avoids midnight off-by-one bugs.

**Filter behaviour:**

- **On mount:** `quickPreset = '24h'`, no explicit `fromDate`/`toDate` sent (backend applies 24h default), fetch page 1 and users list in parallel.
- **Quick preset buttons:**
  - `24h`: set `quickPreset = '24h'`, clear `fromDate`/`toDate`/`recordId`, reset to page 1, fetch (no date params sent — backend applies 24h default).
  - `7d`: set `quickPreset = '7d'`, clear `fromDate`/`toDate`/`recordId`, reset to page 1, fetch with explicit `from_dt = T-7d T00:00:00` and `to_dt = now T23:59:59`.
  - `30d`: same as `7d` but T-30d.
- **"Custom range…" button:** set `quickPreset = 'custom'`, show two `<input type="date">` fields inline (From / To). On change of either field: `quickPreset` stays `'custom'` while the custom inputs are visible; clear `recordId`, reset to page 1, fetch only when both `fromDate` and `toDate` have values (do not fetch with a half-filled range).
- **Table / Action / User dropdowns:** set the relevant filter, reset to page 1, fetch.
- **Clicking a record ID:** set `recordId` to the full UUID, clear `quickPreset`/`fromDate`/`toDate`, reset to page 1, fetch. Full lifecycle of that record is returned.
- **Removing a filter chip (✕):** clear that filter value. If `recordId` chip is removed and no date filter remains active, restore `quickPreset = '24h'` (so the page returns to a sensible default rather than showing all-time records).
- **"Clear all":** reset filters to initial state (`quickPreset = '24h'`, all others null), reset to page 1, fetch.

**Active filter chip labels:**

| Filter | Chip label |
|---|---|
| `quickPreset = '24h'` | `Last 24 hours` |
| `quickPreset = '7d'` | `Last 7 days` |
| `quickPreset = '30d'` | `Last 30 days` |
| `quickPreset = 'custom'` with both dates set | `From: 2026-04-01  To: 2026-04-03` (single chip) |
| `quickPreset = 'custom'` with one date missing | No chip shown; the two date inputs remain visible until both are filled |
| `tableName` | `Table: Users` |
| `action` | `Action: UPDATE` |
| `changedBy` | `User: alice` (resolved from the users list in state) |
| `recordId` | `Record: <full UUID>` |

**Table layout:** accordion rows. Each row:
- Expand/collapse chevron (▶ / ▼)
- `changed_at` — formatted as `14 Apr 2026, 09:41` using `new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })`
- Action badge — colour-coded using the existing `Badge` component: INSERT (green), UPDATE (yellow), DELETE (red), EXPORT (blue), ACCESS/null (grey)
- `table_name`
- Record ID — rendered as a `<button>` with `title={fullUuid}` (native tooltip showing full UUID on hover); visually truncated to first 8 chars + `…`; clicking adds it as a `recordId` filter. If `record_id` is null, render `—`.
- `changed_by_username` — rendering rules:
  - Username resolved: show username.
  - `changed_by` is null on a core schema table (Users, Connections, ConnectionPermissions, Secrets, ColumnMasks, SavedQueries): render `Direct DB access` in amber — indicates the change was made outside admin-it (e.g. via SSMS). The trigger fired but no admin-it session context was present.
  - `changed_by` is null on a non-schema table or for action types ACCESS/EXPORT: render `System` (automated/internal operation with no user attribution).

**Expanded diff view:** renders inside the accordion row when `expandedRows[entry.id]` is true.

- `old_data` and `new_data` from the API are arrays (SQL Server FOR JSON AUTO wrapping) — always read `data[0]` to get the record object. If `data` is null or empty, treat as no data for that side.
- Compute the union of all keys from `(old_data?.[0] ?? {})` and `(new_data?.[0] ?? {})`.
- For each key, determine if the value changed: `JSON.stringify(oldVal) !== JSON.stringify(newVal)`.
- Render a three-column table: Field | Before | After.
  - **Unchanged row:** all columns in muted grey.
  - **Changed row:** field name column amber/yellow; Before cell red background; After cell green background.
  - **INSERT** (old_data is null): Before column shows `—` for all fields; all rows rendered as "changed" (green After).
  - **DELETE** (new_data is null): After column shows `—` for all fields; all rows rendered as "changed" (red Before).
- Sort changed fields to the top, unchanged fields below (improves scannability).

**Empty state:** if `entries` is empty after a fetch, render `<EmptyState message="No audit entries match your filters." />`.

**Error state:** if the API returns 403, render `<EmptyState message="You don't have permission to view the audit log." />`. If 501, render `<EmptyState message="Audit log is not available for this installation." />`. Other errors show a generic error message.

**Pagination:** matches the DataBrowserPage pattern — first/prev/numbered window/next/last buttons, page size selector (50 / 100 / 200). Reset to page 1 whenever any filter changes.

**Access control:** page is wrapped in `RequireAuth` in the router (already present). No additional client-side role gate is needed — rely on the API 403 → empty state flow.

### Sidebar update

In `Sidebar.jsx`, set `implemented: true` for the Audit Log nav item.

### Routing

In `App.jsx`, the `/audit/*` route already has `RequireAuth` and `AppShell` wrappers. Replace only the inner `<ComingSoon title="Audit Log" />` with `<AuditLogPage />`. Do not add duplicate wrappers.

---

## Security

- Both endpoints require `Admin` or `SystemAdmin` role — enforced via `ADMIN_ROLES.intersection(user.get("roles", []))` inline in each handler, consistent with the existing pattern in `audit_routes.py`.
- All SQL filter values passed as SQLAlchemy named bind parameters — no user input interpolated into SQL.
- `changed_by` and `record_id` query params typed as `Optional[UUID]` in FastAPI — Pydantic validates format automatically (422 on malformed input).
- The schema name in the SQL template is f-string interpolated from `backend.schema` (encrypted config, not user input) — consistent with the documented acceptable pattern throughout the codebase.
- Both endpoints read from `audit_log` and `Users` only — no writes, no mutation.

---

## Tradeoffs & decisions

| Decision | Rationale |
|---|---|
| Server-side pagination + filtering | The audit log can grow large; fetching all records to the client is not viable long-term. |
| Username resolved server-side via JOIN | Avoids a separate client-side lookup; keeps the response self-contained. |
| Record ID truncated visually with tooltip | UUIDs are wide; full UUID in every row would make the table unreadable. Tooltip + click-to-filter gives full access without clutter. |
| Clicking record ID clears date range | The whole point of record-lifecycle mode is to see the full history — a date filter would silently hide early entries. |
| Backend owns the 24h default | Keeps the frontend stateless with respect to "now"; avoids clock skew issues; easier to test the default independently. |
| `old_data`/`new_data` are arrays (FOR JSON AUTO) | SQL Server's FOR JSON AUTO wraps results in an array. The frontend always reads `data[0]` to get the record object. |
| Plain object for `expandedRows` | Avoids the `Set`-in-`useReducer` re-render pitfall. |
| Local date boundaries (`T00:00:00` / `T23:59:59`) | `changed_at` is server-local time with no timezone. Sending UTC boundaries would produce off-by-one-day filter bugs at midnight. |
