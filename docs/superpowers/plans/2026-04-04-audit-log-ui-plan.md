# Implementation Plan — Audit Log UI (#18)

**Spec:** `docs/superpowers/specs/2026-04-03-audit-log-ui-design.md`  
**Branch:** `feature/18-audit-log-ui`

---

## Step 1 — Create branch

```bash
git checkout main && git pull
git checkout -b feature/18-audit-log-ui
```

---

## Step 2 — Update `CoreBackend` protocol (`backend/app/backends/core_backend.py`)

Replace the existing `get_audit_records` signature:

```python
from datetime import datetime
from typing import Literal, Protocol
from uuid import UUID

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
) -> dict:
    """Return paginated, filtered audit log entries."""
    ...
```

Return type changes from `list[dict]` to `dict` (the paginated response envelope).

---

## Step 3 — Update Postgres backend stub (`backend/app/backends/postgres_backend.py`)

Find the existing `get_audit_records` stub and update its signature to match the protocol (same params, same return type). Body remains `raise NotImplementedError(...)`.

---

## Step 4 — Rewrite `MSSQLBackend.get_audit_records` (`backend/app/backends/mssql_backend.py`)

Replace the current TOP 1000 implementation with a paginated, filtered query.

**Imports to add at top of file (if not already present):**
```python
from datetime import datetime, timedelta
from typing import Literal
from uuid import UUID
```

**New implementation structure:**

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
) -> dict:
    schema = self.schema

    # Apply 24h default only when no date or record filter is present
    if record_id is None and from_dt is None and to_dt is None:
        from_dt = datetime.utcnow() - timedelta(hours=24)

    # Build WHERE clauses and bind params
    where_clauses = ["1=1"]
    params: dict = {}

    if table_name is not None:
        where_clauses.append("a.[table_name] = :table_name")
        params["table_name"] = table_name

    if action is not None:
        where_clauses.append("a.[action] = :action")
        params["action"] = action

    if changed_by is not None:
        where_clauses.append("a.[changed_by] = :changed_by")
        params["changed_by"] = str(changed_by)

    if record_id is not None:
        where_clauses.append("a.[record_id] = :record_id")
        params["record_id"] = str(record_id)

    if from_dt is not None:
        where_clauses.append("a.[changed_at] >= :from_dt")
        params["from_dt"] = from_dt

    if to_dt is not None:
        where_clauses.append("a.[changed_at] <= :to_dt")
        params["to_dt"] = to_dt

    where_sql = " AND ".join(where_clauses)
    offset = (page - 1) * page_size

    sql = text(f"""
        SELECT
            a.[id], a.[table_name], a.[record_id], a.[action],
            a.[changed_by], u.[Username] AS [changed_by_username],
            a.[changed_at], a.[old_data], a.[new_data]
        FROM [{schema}].[audit_log] a
        LEFT JOIN [{schema}].[Users] u ON a.[changed_by] = u.[UserId]
        WHERE {where_sql}
        ORDER BY a.[changed_at] DESC
        OFFSET :offset ROWS FETCH NEXT :page_size ROWS ONLY
    """)
    params["offset"] = offset
    params["page_size"] = page_size

    count_sql = text(f"""
        SELECT COUNT(*) AS total
        FROM [{schema}].[audit_log] a
        WHERE {where_sql}
    """)

    with self._engine.connect() as conn:
        rows = conn.execute(sql, params).fetchall()
        total_count = conn.execute(count_sql, {k: v for k, v in params.items()
                                                if k not in ("offset", "page_size")}).scalar()

    import math
    total_pages = math.ceil(total_count / page_size) if total_count else 1

    return {
        "entries": [
            {
                "id": str(m["id"]),
                "table_name": m["table_name"],
                "record_id": str(m["record_id"]) if m["record_id"] else None,
                "action": m["action"],
                "changed_by": str(m["changed_by"]) if m["changed_by"] else None,
                "changed_by_username": m["changed_by_username"],
                "changed_at": m["changed_at"].isoformat() if m["changed_at"] else None,
                "old_data": _parse_json(m["old_data"]),
                "new_data": _parse_json(m["new_data"]),
            }
            for r in rows
            for m in (r._mapping,)
        ],
        "total_count": total_count,
        "page": page,
        "page_size": page_size,
        "total_pages": total_pages,
    }
```

Note: SQL Server supports `OFFSET … FETCH NEXT … ROWS ONLY` (requires `ORDER BY` — which we have).

---

## Step 5 — Extend `audit_routes.py` (`backend/app/routes/audit_routes.py`)

Replace the current parameterless handler and add the `/users` sub-route.

**Imports needed:**
```python
from datetime import datetime
from typing import Literal, Optional
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, Query
```

**Updated `GET /api/audit`:**

```python
@router.get("")
def list_audit_records(
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    table_name: Optional[str] = Query(None),
    action: Optional[Literal["INSERT", "UPDATE", "DELETE", "ACCESS", "EXPORT"]] = Query(None),
    changed_by: Optional[UUID] = Query(None),
    record_id: Optional[UUID] = Query(None),
    from_dt: Optional[datetime] = Query(None),
    to_dt: Optional[datetime] = Query(None),
    user: dict = Depends(verify_token),
):
    if not ADMIN_ROLES.intersection(user.get("roles", [])):
        raise HTTPException(status_code=403, detail="Admin role required")

    backend = get_backend()
    try:
        return backend.get_audit_records(
            page=page,
            page_size=page_size,
            table_name=table_name,
            action=action,
            changed_by=changed_by,
            record_id=record_id,
            from_dt=from_dt,
            to_dt=to_dt,
        )
    except NotImplementedError:
        raise HTTPException(
            status_code=501,
            detail="Audit log is not yet available for this backend type",
        )
```

**New `GET /api/audit/users`:**

```python
@router.get("/users")
def list_audit_users(user: dict = Depends(verify_token)):
    """Return active users for the audit log filter dropdown."""
    if not ADMIN_ROLES.intersection(user.get("roles", [])):
        raise HTTPException(status_code=403, detail="Admin role required")

    backend = get_backend()
    schema = backend.schema
    try:
        with backend._engine.connect() as conn:
            rows = conn.execute(
                text(f"""
                    SELECT [UserId], [Username]
                    FROM [{schema}].[Users]
                    WHERE [IsActive] = 1
                    ORDER BY [Username]
                """)
            ).fetchall()
        return [{"id": str(r["UserId"]), "username": r["Username"]} for r in rows]
    except NotImplementedError:
        raise HTTPException(status_code=501, detail="Audit log is not yet available for this backend type")
```

---

## Step 6 — Backend checks

```bash
cd backend
ruff check .        # must exit 0
ruff format --check .  # must exit 0 (run ruff format . first if needed)
```

---

## Step 7 — Create `AuditLogPage.jsx` (`frontend/src/pages/AuditLogPage.jsx`)

New file. Full structure:

### 7a — Constants and helpers at the top of the file

```js
const CORE_TABLES = new Set(['Users','Connections','ConnectionPermissions','Secrets','ColumnMasks','SavedQueries']);
const ACTION_BADGE = {
  INSERT: 'green',
  UPDATE: 'yellow',
  DELETE: 'red',
  EXPORT: 'blue',
  ACCESS: 'default',
};

function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function changedByLabel(entry) {
  if (entry.changed_by_username) return entry.changed_by_username;
  if (!entry.changed_by && CORE_TABLES.has(entry.table_name)) return 'Direct DB access';
  return 'System';
}

function changedByClassName(entry) {
  if (!entry.changed_by && CORE_TABLES.has(entry.table_name)) return 'text-amber-600 font-medium';
  return 'text-gray-500';
}
```

### 7b — `useReducer` setup

Actions: `LOADING`, `LOADED`, `ERROR`, `SET_USERS`, `SET_FILTER`, `SET_PAGE`, `SET_PAGE_SIZE`, `TOGGLE_ROW`.

Initial state:
```js
const initialState = {
  status: 'loading',
  entries: [],
  totalCount: 0,
  page: 1,
  pageSize: 50,
  totalPages: 0,
  users: [],
  filters: {
    quickPreset: '24h',
    fromDate: null,
    toDate: null,
    tableName: null,
    action: null,
    changedBy: null,
    recordId: null,
  },
  expandedRows: {},
};
```

Reducer handles:
- `LOADING` → `{ ...state, status: 'loading' }`
- `LOADED` → spread entries + pagination fields, `status: 'loaded'`
- `ERROR` → `{ ...state, status: 'error', errorCode: action.code }`
- `SET_USERS` → `{ ...state, users: action.users }`
- `SET_FILTER` → `{ ...state, filters: { ...state.filters, ...action.patch }, page: 1, expandedRows: {} }`
- `SET_PAGE` → `{ ...state, page: action.page }`
- `SET_PAGE_SIZE` → `{ ...state, pageSize: action.pageSize, page: 1 }`
- `TOGGLE_ROW` → `{ ...state, expandedRows: { ...state.expandedRows, [action.id]: !state.expandedRows[action.id] } }`

### 7c — `buildQueryString(filters, page, pageSize)` helper

Converts the filter state to URL query params for `fetch('/api/audit?...')`.

- `quickPreset = '24h'` → send no date params (backend default applies)
- `quickPreset = '7d'` → compute `from_dt = T-7d T00:00:00`, `to_dt = today T23:59:59`
- `quickPreset = '30d'` → compute `from_dt = T-30d T00:00:00`, `to_dt = today T23:59:59`
- `quickPreset = 'custom'` → send `fromDate + 'T00:00:00'` as `from_dt`, `toDate + 'T23:59:59'` as `to_dt` (only if both non-null)
- All other filters: append if non-null

### 7d — Data fetching

`useEffect` on `[filters, page, pageSize]`: dispatch `LOADING`, call `buildQueryString`, `fetch('/api/audit?' + qs, { headers: authHeader() })`. On 403 dispatch `ERROR` with `code: 403`; on 501 dispatch `ERROR` with `code: 501`; otherwise dispatch `LOADED`.

On mount also fetch `GET /api/audit/users` in parallel and dispatch `SET_USERS`.

### 7e — Filter bar rendering

Row 1 — Quick presets (pill buttons) + Table/Action/User dropdowns:
- Quick preset buttons: `Last 24h`, `Last 7 days`, `Last 30 days`, `Custom range…`
- Active preset gets `bg-blue-50 border-blue-300 text-blue-700`; inactive gets `bg-gray-100 text-gray-600`
- When `quickPreset = 'custom'`: show two `<input type="date">` fields inline with labels "From" and "To"
- Table dropdown: `<Select>` with `All tables` + distinct table names (derive from entries already loaded, or hardcode the core table list)
- Action dropdown: `<Select>` with `All actions` + INSERT/UPDATE/DELETE/ACCESS/EXPORT
- User dropdown: `<Select>` with `All users` + `users` from state

Row 2 — Active filter chips: render one chip per active filter. Each chip has an `×` button that dispatches `SET_FILTER` to clear that field (and restores `quickPreset: '24h'` if `recordId` chip is removed and no dates remain).

"Clear all" link resets filters to `initialState.filters`.

### 7f — Table rendering

Accordion rows — for each `entry` in `entries`:

```jsx
<div key={entry.id} className="border rounded-md mb-2 overflow-hidden">
  {/* Header row — always visible */}
  <button
    className="w-full flex items-center gap-3 px-3 py-2 text-sm text-left hover:bg-gray-50"
    onClick={() => dispatch({ type: 'TOGGLE_ROW', id: entry.id })}
  >
    <span className="text-gray-400 w-3">{expandedRows[entry.id] ? '▼' : '▶'}</span>
    <span className="text-gray-500 w-40">{formatDate(entry.changed_at)}</span>
    <Badge variant={ACTION_BADGE[entry.action] ?? 'default'}>{entry.action}</Badge>
    <span className="font-medium text-gray-800 w-36">{entry.table_name}</span>
    {/* Record ID — truncated visually, full UUID in title tooltip */}
    {entry.record_id ? (
      <button
        title={entry.record_id}
        className="font-mono text-xs text-blue-600 underline hover:text-blue-800"
        onClick={(e) => { e.stopPropagation(); dispatch({ type: 'SET_FILTER', patch: { recordId: entry.record_id, quickPreset: null, fromDate: null, toDate: null } }); }}
      >
        {entry.record_id.slice(0, 8)}…
      </button>
    ) : <span className="text-gray-400 text-xs">—</span>}
    <span className={changedByClassName(entry)}>{changedByLabel(entry)}</span>
  </button>

  {/* Expanded diff — only when expanded */}
  {expandedRows[entry.id] && <DiffView oldData={entry.old_data} newData={entry.new_data} />}
</div>
```

### 7g — `DiffView` sub-component

```jsx
function DiffView({ oldData, newData }) {
  const oldObj = oldData?.[0] ?? null;
  const newObj = newData?.[0] ?? null;
  const keys = [...new Set([...Object.keys(oldObj ?? {}), ...Object.keys(newObj ?? {})])];

  // Sort changed keys to top
  const changed = keys.filter(k => JSON.stringify(oldObj?.[k]) !== JSON.stringify(newObj?.[k]));
  const unchanged = keys.filter(k => JSON.stringify(oldObj?.[k]) === JSON.stringify(newObj?.[k]));
  const sortedKeys = [...changed, ...unchanged];

  return (
    <div className="border-t border-blue-200 bg-white px-3 py-2">
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr className="bg-gray-50 border-b border-gray-200">
            <th className="text-left px-2 py-1 text-gray-500 uppercase tracking-wide w-1/5">Field</th>
            <th className="text-left px-2 py-1 text-gray-500 uppercase tracking-wide w-2/5">Before</th>
            <th className="text-left px-2 py-1 text-gray-500 uppercase tracking-wide w-2/5">After</th>
          </tr>
        </thead>
        <tbody>
          {sortedKeys.map(k => {
            const isChanged = JSON.stringify(oldObj?.[k]) !== JSON.stringify(newObj?.[k]);
            const oldVal = oldObj?.[k] !== undefined ? String(oldObj[k]) : null;
            const newVal = newObj?.[k] !== undefined ? String(newObj[k]) : null;
            return (
              <tr key={k} className={isChanged ? 'bg-amber-50 border-b border-gray-100' : 'border-b border-gray-100'}>
                <td className={`px-2 py-1 ${isChanged ? 'text-amber-800 font-semibold' : 'text-gray-400'}`}>{k}</td>
                <td className={`px-2 py-1 ${isChanged ? 'bg-red-50 text-red-800 font-medium' : 'text-gray-400'}`}>
                  {oldVal ?? <span className="italic">—</span>}
                </td>
                <td className={`px-2 py-1 ${isChanged ? 'bg-green-50 text-green-800 font-medium' : 'text-gray-400'}`}>
                  {newVal ?? <span className="italic">—</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
```

### 7h — Pagination

Reuse the same pattern as `DataBrowserPage`. Render first/prev/numbered window/next/last buttons + page size selector (`50 / 100 / 200`). Each button dispatches `SET_PAGE` or `SET_PAGE_SIZE`.

### 7i — Empty/error states

- `status === 'loading'` → `<Spinner />`
- `status === 'error'` with `errorCode === 403` → `<EmptyState message="You don't have permission to view the audit log." />`
- `status === 'error'` with `errorCode === 501` → `<EmptyState message="Audit log is not available for this installation." />`
- `status === 'loaded'` with `entries.length === 0` → `<EmptyState message="No audit entries match your filters." />`

---

## Step 8 — Wire up routing and sidebar

**`frontend/src/App.jsx`** — replace only the inner component at `/audit/*`:
```jsx
// Before:
<ComingSoon title="Audit Log" />
// After:
<AuditLogPage />
```
Add import: `import AuditLogPage from './pages/AuditLogPage';`

**`frontend/src/components/Sidebar.jsx`** — change `implemented: false` to `implemented: true` for the Audit Log nav item.

---

## Step 9 — Frontend checks

```bash
cd frontend
npm run lint          # must exit 0
npm run format:check  # must exit 0 (run prettier --write . first if needed)
```

---

## Step 10 — Self-review checklist

Before raising the PR, verify:

- [ ] All SQL identifiers bracket-quoted (`[table]`, `[column]`)
- [ ] `action` param uses `Literal[...]` — not bare `str` — in both route and protocol
- [ ] `changed_by` and `record_id` passed as bind params (never interpolated)
- [ ] Schema name f-string interpolated from `backend.schema` only (not user input)
- [ ] `GET /api/audit` and `GET /api/audit/users` both enforce `ADMIN_ROLES` check
- [ ] `TOGGLE_ROW` returns a new object (not mutated `expandedRows`)
- [ ] `7d`/`30d` presets send explicit `from_dt`/`to_dt` to the backend
- [ ] Record ID click clears date range filters
- [ ] `Direct DB access` rendered in amber for null `changed_by` on core tables

---

## Step 11 — Commit, push, open PR

```bash
git add -p   # stage selectively
git commit -m "feat(#18): audit log UI — paginated, filtered, accordion diff view"
git push -u origin feature/18-audit-log-ui
gh pr create --title "feat(#18): audit log UI" --body "..."
```

PR description must cover: what changed, security model (Admin role enforced at route, all SQL parameterised, schema name from encrypted config), and the `Direct DB access` behaviour for out-of-band changes.
