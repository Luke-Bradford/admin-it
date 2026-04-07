# Implementation Plan — Query Scheduling (#140)

**Spec:** `docs/specs/query-scheduling.md`
**Issue:** #140
**Strategy:** Six bounded PRs in order. Each PR is independently reviewable, independently mergeable, and leaves `main` in a working state. No PR merges with broken or half-wired functionality.

---

## Why six PRs

A single PR for this feature would be ~3,000 lines and would touch the DB schema, the route layer, a brand-new scheduler subsystem, two new utility modules, the email subsystem, six new frontend pages, and a refactor extraction. Reviewers would either rubber-stamp it or block on a tangential concern. Splitting forces each commit to do one thing and forces the reviewer (human or bot) to engage with that thing on its own merits.

The split also means partial merges are valuable — after PR 2 lands, an admin can configure SMTP and send test emails, even though the scheduling feature itself doesn't exist yet. After PR 4, scheduling works via the API even without a UI. Each PR adds a *complete vertical slice* of capability.

## PR sequence and dependency graph

```
PR 1 — Refactor extractions (no behaviour change)
   └─→ PR 2 — SMTP settings (backend + frontend, end-to-end testable)
          └─→ PR 3 — Schedule schema + CRUD API + scheduler bootstrap (no execution)
                 └─→ PR 4 — Runner + execution + housekeeping (cron + run-now work)
                        └─→ PR 5 — Schedule frontend (list, form, detail pages)
                               └─→ PR 6 — User guide wiki page
```

PR 1 is a pure refactor with zero behaviour change — it can merge in isolation as a small cleanup. PRs 2 through 5 each add a layer of capability that's testable end-to-end. PR 6 documents the feature for users.

---

# PR 1 — Refactor extractions

**Branch:** `refactor/140-extract-query-executor-and-result-export`
**Estimated diff size:** ~400 lines moved, no new logic
**Goal:** Pull `query_executor` and `result_export` out of the route handlers into reusable utility modules so the scheduler can call them without importing route handlers. Eliminate the duplicated `MAX_EXPORT_ROWS` constant in passing.

## Step 1.1 — Create the constants module

**File:** `backend/app/utils/constants.py` (new)

```python
"""Centralised constants used by both routes and scheduler."""

# Maximum rows returned by a single export request (CSV/XLSX) and
# by a single scheduled-run delivery. Was previously duplicated in
# data_routes.py and query_routes.py.
MAX_EXPORT_ROWS = 10_000
```

This is the only step needed for the constant consolidation. PR 4 will add the scheduling-specific constants alongside it.

## Step 1.2 — Create `query_executor.py`

**File:** `backend/app/utils/query_executor.py` (new)

Move the saved-query execution logic out of `query_routes.py` (currently inline in the `run_saved_query` route handler around lines 750–870). The new module exposes a single function:

```python
from typing import Any
from uuid import UUID
from sqlalchemy.engine import Engine

def execute_saved_query(
    engine: Engine,
    schema: str,
    saved_query_id: UUID,
    parameter_values: dict[str, str],
    as_user_id: UUID,
) -> tuple[list[dict[str, Any]], list[str], int, bool]:
    """
    Execute a saved query under the effective permissions of `as_user_id`.

    Returns:
        rows         — list of dicts (one per row, column-name keyed)
        column_names — ordered list of column names as the SQL returned them
        total_count  — count from a separate COUNT(*) query *before* truncation
        truncated    — True if total_count > MAX_EXPORT_ROWS

    Applies column masking from #15 under `as_user_id`'s role at call time.
    Caps row count at MAX_EXPORT_ROWS.
    """
```

The body is the existing logic from `query_routes.py`, lifted unchanged. The route handler in `query_routes.py` becomes a thin wrapper that calls this function and packages the result for HTTP response.

**Critical:** the function takes `as_user_id` as a parameter rather than reading the JWT. This is the change that makes it callable from the scheduler (which has no JWT). The route handler passes `current_user["user_id"]`; the scheduler will pass `schedule.owner_user_id`.

## Step 1.3 — Create `result_export.py`

**File:** `backend/app/utils/result_export.py` (new)

Move the CSV and XLSX rendering out of `data_routes.py` (lines ~440–510) and `query_routes.py` (lines ~810–870, the export branch of `run_saved_query`). Single module with two functions:

```python
def render_csv(rows: list[dict], column_names: list[str]) -> bytes:
    """Render rows as CSV bytes (UTF-8 with BOM, RFC 4180 quoting)."""

def render_xlsx(rows: list[dict], column_names: list[str], sheet_name: str = "Results") -> bytes:
    """Render rows as XLSX bytes via openpyxl."""
```

Both `data_routes.py` and `query_routes.py` are updated to call these instead of inlining the logic. No behaviour changes — verify by running the existing tests after the move.

## Step 1.4 — Delete the duplicated `MAX_EXPORT_ROWS` definitions

Remove `MAX_EXPORT_ROWS = 10_000` from `data_routes.py:42` and `query_routes.py:48`. Both files now `from app.utils.constants import MAX_EXPORT_ROWS`.

## Step 1.5 — Verify

```bash
cd backend && ruff check . && ruff format --check .
# Run the existing test suite — every test must still pass
pytest
```

## PR 1 description checklist

- [x] One-paragraph summary: pure refactor, no behaviour change, eliminates duplication, prepares for #140.
- [x] Test plan: list the existing tests that should still pass (saved query export CSV, saved query export XLSX, data browser export).
- [x] Explicitly state: "no new tests in this PR — the existing tests cover the moved logic". Reviewers will ask.

---

# PR 2 — SMTP settings (backend + frontend)

**Branch:** `feature/140-smtp-settings`
**Estimated diff size:** ~600 lines (backend route, settings table, frontend page, integration tests)
**Goal:** Admin can configure SMTP via a UI, click "Send test email", and verify connectivity. No scheduling yet.

## Step 2.1 — Add the `[adm].[Settings]` table to both backends

**Files:**
- `backend/app/sql/spDeployCoreSchema.sql` — add the SQL Server DDL.
- `backend/app/sql/deploy_core_schema_postgres.sql` — add the Postgres DDL.

```sql
-- SQL Server
CREATE TABLE [{schema}].[Settings] (
    SettingKey       NVARCHAR(100)  NOT NULL PRIMARY KEY,
    SettingValue     NVARCHAR(MAX)  NOT NULL,
    UpdatedAt        DATETIME2      NOT NULL DEFAULT SYSUTCDATETIME(),
    UpdatedBy        UNIQUEIDENTIFIER NULL
);
```

```sql
-- Postgres
CREATE TABLE {schema}.settings (
    setting_key    VARCHAR(100)  NOT NULL PRIMARY KEY,
    setting_value  TEXT          NOT NULL,
    updated_at     TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_by     UUID          NULL
);
```

The schema name is f-string interpolated from `config.schema` per the existing pattern — never user-controlled.

**Note for the implementer:** `spDeployCoreSchema.sql` is the canonical SQL Server deploy script; the corresponding Postgres script must be kept in lock-step. Both backends use the same logical key/value semantics. Keys are JSON-encoded values stored as text.

## Step 2.2 — Add SMTP password storage

The SMTP password lives in `[adm].[Secrets]` (the existing table that holds `JWT_SECRET`), keyed `SMTP_PASSWORD`. No schema change — `Secrets` already exists as a generic key/value table.

## Step 2.3 — Create the email sender utility

**File:** `backend/app/utils/email_sender.py` (new)

```python
import smtplib
from email.message import EmailMessage
from typing import Literal

class EmailSendError(Exception):
    """Raised when an email cannot be sent. Contains the SMTP server's response."""

def send_email(
    *,
    host: str,
    port: int,
    tls_mode: Literal["none", "starttls", "tls"],
    username: str | None,
    password: str | None,
    from_address: str,
    from_name: str | None,
    reply_to: str | None,
    to: list[str],
    subject: str,
    body: str,
    attachment_bytes: bytes | None = None,
    attachment_filename: str | None = None,
) -> None:
    """
    Send a single email. Raises EmailSendError on any failure.
    Uses stdlib smtplib + email.message.EmailMessage. No external deps.
    """
```

The implementer should:
- Use `smtplib.SMTP_SSL` for `tls_mode='tls'`, `smtplib.SMTP` + `starttls()` for `tls_mode='starttls'`, plain `smtplib.SMTP` for `tls_mode='none'`.
- Set `Reply-To` header from `reply_to` if non-None, otherwise omit.
- Set `From` as `f"{from_name} <{from_address}>"` if `from_name` is set, otherwise just `from_address`.
- Attachment MIME type: `text/csv` for `.csv`, `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` for `.xlsx`.
- Wrap every smtplib call in try/except and re-raise as `EmailSendError(str(original))` so callers don't need to know about smtplib.

## Step 2.4 — Pydantic models

**File:** `backend/app/models/settings.py` (new)

```python
from typing import Literal
from pydantic import BaseModel, EmailStr, Field

TlsMode = Literal["none", "starttls", "tls"]

class SmtpSettingsOut(BaseModel):
    host: str | None
    port: int | None
    tls_mode: TlsMode | None
    username: str | None
    from_address: str | None
    from_name: str | None
    reply_to_address: str | None
    allowlist_enabled: bool
    allowed_domains: list[str]
    password_set: bool   # never returns the password itself

class SmtpSettingsUpdate(BaseModel):
    host: str = Field(min_length=1, max_length=255)
    port: int = Field(ge=1, le=65535)
    tls_mode: TlsMode
    username: str | None = None
    from_address: EmailStr
    from_name: str | None = None
    reply_to_address: EmailStr | None = None
    allowlist_enabled: bool = False
    allowed_domains: list[str] = []

class SmtpPasswordUpdate(BaseModel):
    password: str = Field(min_length=1, max_length=500)

class SmtpTestRequest(BaseModel):
    to: EmailStr
```

`TlsMode` is a `Literal[...]` per CLAUDE.md self-review rule — no bare `str` for bounded sets.

## Step 2.5 — Settings routes

**File:** `backend/app/routes/settings_routes.py` (new)

Four routes, all `Admin+`:

| Route | Method | Body | Returns |
|---|---|---|---|
| `/api/settings/smtp` | GET | — | `SmtpSettingsOut` |
| `/api/settings/smtp` | PUT | `SmtpSettingsUpdate` | `SmtpSettingsOut` |
| `/api/settings/smtp/password` | PUT | `SmtpPasswordUpdate` | `204 No Content` |
| `/api/settings/smtp/test` | POST | `SmtpTestRequest` | `{"ok": true}` or `{"ok": false, "error": "..."}` |

Each handler:
1. `Depends(verify_token)`.
2. First line: `if not _is_admin_or_above(current_user): raise HTTPException(403)`. The role helper goes in `auth_dependency.py` if not already there.
3. Settings table reads use bind parameters; SettingValue is JSON-encoded so reads decode and writes encode via `json.loads` / `json.dumps`.
4. PUT validates the body, stores each field as a separate `Settings` row keyed `smtp.host`, `smtp.port`, etc.
5. Password PUT writes to `Secrets` keyed `SMTP_PASSWORD` (encrypted via the existing pattern).
6. Test endpoint loads the current SMTP config + password, calls `email_sender.send_email`, returns success or `{"ok": false, "error": str(EmailSendError)}` (status 200 either way; the body conveys success).

PUT with all-None body returns 422 (CLAUDE.md self-review rule).

## Step 2.6 — Register the router

**File:** `backend/app/main.py`

Add `app.include_router(settings_routes.router)` next to the other route registrations.

## Step 2.7 — Frontend SMTP settings page

**File:** `frontend/src/pages/SmtpSettingsPage.jsx` (new)
**Route:** add `<Route path="/settings/smtp" element={<RequireAuth roles={["Admin", "SystemAdmin"]}><SmtpSettingsPage /></RequireAuth>} />` in the main router.

UI structure:
- Form fields: host, port, TLS mode (radio: None / STARTTLS / TLS), username, from address, from display name, reply-to address.
- Toggle: "Restrict outbound mail to allowed domains". When on, exposes a chip-list editor for allowed domains.
- Separate panel: "SMTP password" — write-only password input + "Update password" button. Shows a "Password is set" badge if `password_set: true`.
- "Send test email" button at the bottom that opens a small modal asking for a recipient address, then POSTs to `/api/settings/smtp/test` and shows the result.
- Inline info note (text only): *"If you're sending to recipients outside your organisation, ensure your DNS has SPF and DKIM records authorising this SMTP host to send as the From address, or recipients may filter messages as spam."*

Use `fetch` (not axios) and `authHeader()` per the existing project conventions. Save handler is one PUT to `/api/settings/smtp`. Password save is a separate PUT.

## Step 2.8 — Header navigation

**File:** `frontend/src/components/Header.jsx`

Add an "SMTP" link under the existing settings/admin navigation, visible only to Admin and SystemAdmin roles. Pattern matches the existing role-conditional links.

## Step 2.9 — Tests

**File:** `backend/tests/test_settings_routes.py` (new)

- GET as User → 403.
- GET as Admin → returns config without password.
- PUT as Admin → persists, GET reflects the change.
- PUT password as Admin → can't be retrieved via GET.
- POST test → uses `aiosmtpd` (or stdlib `smtpd` in a thread) as a fake server, asserts the email arrived, asserts From / Reply-To headers are correct.
- POST test with bad host → returns `{"ok": false, "error": "..."}`, status 200.

## Step 2.10 — Verify and PR

```bash
cd backend && ruff check . && ruff format --check . && pytest
cd ../frontend && npm run lint && npm run format:check
```

PR description must explicitly state:
- This PR adds the SMTP delivery infrastructure used by query scheduling (#140) but does not add scheduling itself.
- After merge, an admin can configure SMTP and send test emails — that's the deliverable.
- Security model: admin-only routes, password never returned by GET, all writes bind-parameterised.

---

# PR 3 — Schedule schema + CRUD API + scheduler bootstrap (no execution)

**Branch:** `feature/140-schedule-crud-and-scheduler`
**Estimated diff size:** ~1,400 lines
**Goal:** All three new schedule tables exist. Schedule CRUD endpoints work. APScheduler is wired in with the leader-lock. Schedules can be created, listed, edited, deleted, enabled, disabled, and tested via `/test`. **The cron-fired job runner is a stub** — it writes a `success` `ScheduledQueryRun` row with no actual query execution. Full execution comes in PR 4.

The split between PR 3 and PR 4 exists because PR 3 is mostly schema and CRUD plumbing (mechanically reviewable), while PR 4 is the runner logic (which has a meaningfully different review surface).

## Step 3.1 — Schedule tables

**Files:**
- `backend/app/sql/spDeployCoreSchema.sql`
- `backend/app/sql/deploy_core_schema_postgres.sql`

Create `ScheduledQuery`, `ScheduledQueryParameter`, and `ScheduledQueryRun` per spec §4.1, §4.2, §4.3. SQL Server uses temporal tables for `ScheduledQuery` (consistent with other core tables); Postgres uses the existing trigger-based audit pattern.

The schema name is interpolated from `config.schema` — never any other identifier.

Constraint reminders the implementer must not skip:
- `ScheduledQueryParameter` CHECK: exactly one of `ValueLiteral` / `ValueToken` is non-null.
- `ScheduledQueryRun.Status` CHECK constraint with the exact five values from spec §4.3.
- Index `(ScheduleId, StartedAt DESC)` on `ScheduledQueryRun` for the "last N runs" query.

**Plan-level addition to spec §4.1 — leader sync columns:**

`ScheduledQuery` gets two extra columns not in the spec:
- `NeedsSync BIT NOT NULL DEFAULT 1` — set to 1 by any non-leader-worker mutation; cleared by the leader after it has applied the change to its in-process scheduler.
- `LastSyncedAt DATETIME2 NULL` — bookkeeping for the leader's poll-for-changes loop.

These exist purely to support the DB-only mutation pattern in Step 3.8 / Step 4.8 (the leader picks up changes via polling, never via direct in-process calls from non-leader workers). They are not user-visible and are not returned by the API. Spec §4.1 should be updated to mention them; tracked in the followup notes for this plan PR.

## Step 3.2 — Add new dependencies

**File:** `backend/requirements.txt`
```
apscheduler>=3.10
cron-descriptor>=1.4
tzdata>=2024.1   # Windows containers don't ship IANA tz data
```

**File:** `frontend/package.json`
```
"cronstrue": "^2.50.0"
```

## Step 3.3 — `schedule_tokens.py`

**File:** `backend/app/utils/schedule_tokens.py` (new)

```python
from datetime import date, datetime, timedelta
from typing import Literal
from zoneinfo import ZoneInfo

ALLOWED_TOKENS = (
    "today",
    "yesterday",
    "start_of_week",       # Monday-based
    "end_of_week",         # Sunday
    "start_of_month",
    "end_of_month",
    "start_of_last_month",
    "end_of_last_month",
)

TokenLiteral = Literal[
    "today", "yesterday",
    "start_of_week", "end_of_week",
    "start_of_month", "end_of_month",
    "start_of_last_month", "end_of_last_month",
]

def resolve_token(token: str, now_utc: datetime, schedule_tz: ZoneInfo) -> date:
    """
    Resolve a token to a concrete date in `schedule_tz`.
    `now_utc` is the only wall-clock value entering the function;
    everything else is derived in the schedule's timezone.
    """
    if token not in ALLOWED_TOKENS:
        raise ValueError(f"Unknown token: {token}")
    local = now_utc.astimezone(schedule_tz).date()
    # ... explicit branch per token, no clever lookup tables ...

def render_template(text: str, resolved: dict[str, dict]) -> str:
    """
    Replace {{token_name}} occurrences with resolved values.
    Unknown tokens are left as literal text (no error).
    `resolved` is the JSON shape from spec §5.3.
    """
```

The `Literal[...]` exists separately from `ALLOWED_TOKENS` because Pydantic needs the literal type at class-definition time, but APIs that allowlist a value against the constant need a runtime tuple. Keep them in sync; the unit test asserts they match.

## Step 3.4 — Pydantic models for schedules

**File:** `backend/app/models/schedule.py` (new)

```python
from typing import Literal
from uuid import UUID
from pydantic import BaseModel, EmailStr, Field, root_validator
from app.utils.schedule_tokens import TokenLiteral

AttachmentFormat = Literal["csv", "xlsx"]
RunStatus = Literal["running", "success", "failure", "skipped", "truncated"]
RunKind = Literal["cron", "manual", "test"]

class ScheduleParameterIn(BaseModel):
    name: str = Field(pattern=r"^[a-zA-Z_][a-zA-Z0-9_]*$", max_length=100)
    value_literal: str | None = None
    value_token: TokenLiteral | None = None

    @root_validator
    def exactly_one_value(cls, values):
        lit, tok = values.get("value_literal"), values.get("value_token")
        if (lit is None) == (tok is None):
            raise ValueError("Exactly one of value_literal / value_token must be set.")
        return values

class ScheduleIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    saved_query_id: UUID
    cron: str = Field(min_length=1, max_length=100)
    timezone: str = Field(min_length=1, max_length=64)
    recipient_emails: list[EmailStr] = Field(min_items=1)
    attachment_format: AttachmentFormat
    email_subject: str = Field(min_length=1, max_length=500)
    email_body: str
    parameters: list[ScheduleParameterIn] = []

class ScheduleUpdate(BaseModel):
    # All fields optional; full-replacement semantics for parameters when present.
    # PATCH with all-None body returns 422 in the route handler.
    ...

class ScheduleOut(BaseModel):
    schedule_id: UUID
    name: str
    saved_query_id: UUID
    saved_query_name: str   # joined for display
    owner_user_id: UUID
    owner_username: str
    owner_role: str         # for the "Runs as: ..." display
    cron: str
    timezone: str
    is_enabled: bool
    recipient_emails: list[str]
    attachment_format: AttachmentFormat
    email_subject: str
    email_body: str
    parameters: list[ScheduleParameterIn]
    last_run_at: datetime | None
    last_run_status: RunStatus | None
    next_run_at: datetime | None
    created_at: datetime
    updated_at: datetime
    scheduler_registered: bool   # see spec §3.2 / §6.1

class ScheduleRunOut(BaseModel):
    run_id: UUID
    kind: RunKind
    started_at: datetime
    finished_at: datetime | None
    duration_ms: int | None
    status: RunStatus
    row_count: int | None
    bytes_sent: int | None
    resolved_parameters: dict | None
    recipient_emails_sent: list[str] | None
    triggered_by_user_id: UUID | None
    error_message: str | None
```

Every bounded-set field is `Literal[...]`. Per CLAUDE.md self-review rule.

## Step 3.5 — Schedule validation helper

**File:** `backend/app/utils/schedule_validation.py` (new)

A single function that runs every validation rule from spec §6.5 and returns either a list of error messages or `None`. Used by both POST and PATCH route handlers so the rule logic isn't duplicated. Each check is a separate small function so they're individually testable.

```python
def validate_schedule(
    *,
    engine: Engine,
    schema: str,
    body: ScheduleIn,
    caller_user_id: UUID,
    caller_role: str,
    smtp_settings: SmtpSettingsOut,
) -> list[str]:
    """Run every validation rule from spec §6.5. Returns error list or empty list."""
```

Rules implemented as separate helpers:
- `_validate_cron(expr, tz)` — uses `CronTrigger.from_crontab(expr, timezone=tz)`.
- `_validate_timezone(tz)` — `ZoneInfo(tz)`, catches `ZoneInfoNotFoundError`.
- `_validate_recipients(emails, smtp_settings)` — domain allowlist if enabled.
- `_validate_smtp_configured(smtp_settings)` — host + password set.
- `_validate_caller_can_access_query(...)` — uses existing #16 access logic.
- `_validate_parameters(body, saved_query_params)` — required present, none extra, types match, tokens valid.

## Step 3.6 — Scheduler bootstrap

**Files:**
- `backend/app/scheduler/__init__.py` (new) — module entry
- `backend/app/scheduler/leader.py` (new) — leader-lock acquisition
- `backend/app/scheduler/sync.py` (new) — DB → APScheduler sync
- `backend/app/scheduler/runner.py` (new) — **stub in PR 3**, full implementation in PR 4

**`leader.py`** acquires the advisory lock at startup and exposes `is_leader() -> bool` and `try_become_leader() -> bool`. The lock implementation differs by backend:

```python
def try_become_leader(engine: Engine, schema: str) -> bool:
    """
    Attempt to acquire the scheduler-leader application lock.
    Returns True if this process is now the leader, False otherwise.
    The lock is held for the lifetime of the connection returned.
    """
```

For SQL Server: `sp_getapplock @Resource = 'admin_it_scheduler_leader', @LockMode = 'Exclusive', @LockOwner = 'Session', @LockTimeout = 0`. Returns `>= 0` on success.

For Postgres: `SELECT pg_try_advisory_lock(hashtext('admin_it_scheduler_leader'))`. Returns `true` on success.

The leader holds a dedicated long-lived connection for the lock. The connection is stored in a module-level singleton and closed only at process shutdown.

**`sync.py`** has two functions:

```python
def register_all_enabled(scheduler: AsyncIOScheduler, engine: Engine, schema: str) -> None:
    """Read all enabled schedules from the DB and register them with APScheduler."""

def add_or_update_job(scheduler: AsyncIOScheduler, schedule_id: UUID, ...) -> None:
def remove_job(scheduler: AsyncIOScheduler, schedule_id: UUID) -> None:
```

`register_all_enabled` runs at startup after leader acquisition. It uses `scheduler.add_job` with `func='app.scheduler.runner:run_schedule'`, `trigger=CronTrigger.from_crontab(...)`, `args=[schedule_id]`, `coalesce=True`, `max_instances=1`, `id=str(schedule_id)`.

**`runner.py`** in PR 3 is a stub:

```python
async def run_schedule(schedule_id: UUID, kind: RunKind = "cron") -> None:
    """
    PR 3 stub: writes a 'success' ScheduledQueryRun row with no execution.
    PR 4 replaces this with the real runner.
    """
    # Acquire per-schedule lock (skip if can't — PR 4 will add this).
    # Insert ScheduledQueryRun row with status='success', row_count=0.
    # Log a warning that this is the stub.
```

The stub exists so PR 3 can demonstrate the wiring works end-to-end (cron fires → runner is called → row appears in `ScheduledQueryRun`) without committing to the execution logic.

## Step 3.7 — Wire the scheduler into FastAPI startup

**File:** `backend/app/main.py`

```python
from contextlib import asynccontextmanager
from app.scheduler import startup_scheduler, shutdown_scheduler

@asynccontextmanager
async def lifespan(app: FastAPI):
    startup_scheduler()
    yield
    shutdown_scheduler()

app = FastAPI(lifespan=lifespan, ...)
```

`startup_scheduler()`:
1. Tries to become leader. If not leader, logs and returns — no APScheduler in this worker.
2. If leader: creates `AsyncIOScheduler`, calls `sync.register_all_enabled`, calls `scheduler.start()`.
3. Registers a follow-up job: `scheduler.add_job(orphaned_run_cleanup, 'date', run_date=now+1s)` to run once at boot. Spec §10 (Container restart edge case).
4. Registers the daily housekeeping job (added properly in PR 4; in PR 3 it's also a stub).

`shutdown_scheduler()` calls `scheduler.shutdown(wait=False)` and releases the leader lock.

## Step 3.8 — Schedule routes

**File:** `backend/app/routes/schedule_routes.py` (new)

Implements every route from spec §6.1, §6.2, §6.3 except the two manual triggers `/test` and `/run-now`. The `/test` endpoint *is* implemented in PR 3 because it sends to the caller and doesn't actually need the runner — it can do its own minimal execution path inline. `/run-now` is **deferred to PR 4** because it requires the real runner.

For each handler:
1. `Depends(verify_token)`.
2. Role check as the first line.
3. Owner-or-admin check via `_assert_owner_or_admin(schedule, current_user)` for PATCH/DELETE/enable/disable.
4. Validation via `validate_schedule(...)`.
5. **Mutations: write to DB only. Never call `sync.add_or_update_job` / `sync.remove_job` from a route handler.** The route handler runs on whatever worker accepted the HTTP request; that's almost always *not* the leader. Calling `sync.*` directly would crash on non-leader workers because their `AsyncIOScheduler` instance doesn't exist.

Instead: route handlers write to the DB and set a `NeedsSync BIT` flag (or bump an `UpdatedAt` column the leader watches) on the affected schedule. The leader's `sync.poll_for_changes()` task runs every `LEADER_CHECK_INTERVAL_SECONDS` (60s by default) and picks up any rows where `NeedsSync=1` or `UpdatedAt > LastSyncedAt`, then calls `add_or_update_job` / `remove_job` on its in-process scheduler. Return `scheduler_registered: false` from the route handler if the caller is not the leader, `true` if it is. Most callers will get `false` and the schedule will fire after the next sync tick (worst case 60s lag).

For tighter propagation in single-worker deployments (the common case), the leader can also watch a `pg_notify` channel (Postgres) or a `Service Broker` queue (SQL Server) — but this is **deferred to a future ticket**. v1 uses the 60s polling tick and accepts the latency.

## Step 3.9 — `/test` endpoint (special case in PR 3)

`POST /api/schedules/{id}/test` is the only manual trigger in PR 3. It needs to:
1. Load the schedule.
2. Execute the saved query under the **caller's** user id (not the owner's). See "Why caller's identity, not owner's" below.
3. Resolve parameters using the schedule's frozen values + tokens.
4. Render the attachment.
5. Send the email **to the caller's own email address only**.
6. Write a `ScheduledQueryRun` row with `Kind='test'`, `triggered_by_user_id=caller`, `recipient_emails_sent=[caller_email]`. **Does not update `LastRunAt` / `LastRunStatus`** on the schedule.

**Why caller's identity, not owner's:**

A test is *the caller testing the schedule*, not a preview of what recipients will see. The caller's permissions and masking apply because:

- Recipients of a real run see what the *owner* would see in the live UI (spec §9). Recipients have no admin-it identity.
- A test goes to the caller alone. The caller is an admin-it user with their own role and masking. Showing them the owner's view would either (a) leak data the caller shouldn't see, or (b) hide data the caller can see — both wrong.
- If a caller wants to preview exactly what recipients will see, they can ask the owner to run `/test`. The owner sees the owner's view; that *is* the recipients' preview.
- Acknowledged consequence: a Power User testing another user's schedule sees a slightly different result than the recipients will. This is the right tradeoff because the alternative — letting a tester see data under someone else's permissions — is a privilege escalation.

PR 4 will refactor `/test` to call the shared runner with a `kind='test', as_user=caller` argument. The runner already takes `as_user_id` per Step 1.2, so this is a one-line plumbing change.

This step duplicates ~30 lines of what PR 4's runner will do, but it's necessary to make PR 3 deliverable on its own.

## Step 3.10 — Tests

**File:** `backend/tests/test_schedule_routes.py` (new)

- CRUD as PowerUser, Admin, regular User.
- Regular User → 403 on every endpoint.
- Owner-or-admin enforcement on PATCH/DELETE/run-now.
- Validation: invalid cron, invalid tz, empty recipients, recipient blocked by allowlist, missing required parameter, extra parameter, token on a non-date parameter, value_token + value_literal both set.
- `/test` end-to-end against fake SMTP: caller PowerUser, schedule with one date parameter using `{{today}}`, verify email arrives at caller's address with the resolved date in the body.

**File:** `backend/tests/test_schedule_tokens.py` (new)

- Every token across DST boundaries (Europe/London spring forward + fall back).
- Every token in three timezones (Europe/London, America/New_York, Pacific/Auckland).
- `render_template` with known and unknown tokens.
- `ALLOWED_TOKENS` matches `TokenLiteral.__args__`.

**File:** `backend/tests/test_schedule_validation.py` (new)

Each `_validate_*` helper independently. Pure function tests, no DB.

## Step 3.11 — Verify and PR

```bash
cd backend && ruff check . && ruff format --check . && pytest
```

PR description must state:
- Adds the schedule data model, CRUD API, scheduler bootstrap with leader-lock, and the `/test` endpoint.
- The cron-triggered runner is a **stub** in this PR — fires correctly but doesn't execute the query. PR 4 adds real execution.
- `/run-now` is **not in this PR**; PR 4 adds it.
- Frontend pages are not in this PR; PR 5 adds them. SMTP UI from PR 2 is the only existing UI for the feature so far.

---

# PR 4 — Runner + execution + housekeeping

**Branch:** `feature/140-runner-and-execution`
**Estimated diff size:** ~700 lines
**Goal:** Replace the runner stub with the real implementation. Cron-fired runs actually execute the query and email the result. `/run-now` works. Failure notifications work. Daily housekeeping runs.

## Step 4.1 — Add the constants for this PR

**File:** `backend/app/utils/constants.py`

```python
MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024
RUN_TIMEOUT_SECONDS = 5 * 60
SUCCESS_RETENTION_DAYS = 90
SCHEDULER_LEADER_LOCK_KEY = "admin_it_scheduler_leader"
ORPHANED_RUN_THRESHOLD_MINUTES = 10
LEADER_CHECK_INTERVAL_SECONDS = 60
```

## Step 4.2 — Per-schedule lock helper

**File:** `backend/app/scheduler/locks.py` (new)

```python
from contextlib import contextmanager
from uuid import UUID

@contextmanager
def per_schedule_lock(engine: Engine, schema: str, schedule_id: UUID):
    """
    Context manager that acquires a per-schedule application lock.
    Yields True if acquired, False if not. Releases on exit.

    SQL Server: sp_getapplock @Resource = 'scheduled_query:{schedule_id}',
                @LockMode = 'Exclusive', @LockOwner = 'Session', @LockTimeout = 0
    Postgres:   pg_try_advisory_lock(hashtext('scheduled_query:{schedule_id}'))
    """
```

**Critical SQLAlchemy connection-pool gotcha:**

`sp_getapplock` with `@LockOwner='Session'` ties the lock to the SQL Server session. If we acquire the lock on a SQLAlchemy `Connection`, then call `connection.close()`, SQLAlchemy returns the connection to the pool — it does **not** end the session. The lock travels with the connection. The next request that checks out the same connection from the pool will inherit a phantom lock, and the runner that originally acquired it will lose its release semantics.

The implementer must use **`connection.detach()` followed by `connection.close()`** to ensure the connection is genuinely destroyed, not pooled:

```python
@contextmanager
def per_schedule_lock(engine, schema, schedule_id):
    conn = engine.connect()
    conn.detach()  # remove from pool — this connection will be destroyed on close
    try:
        result = conn.execute(text("EXEC sp_getapplock ..."), {...}).scalar()
        got = result >= 0
        yield got
    finally:
        if got:
            conn.execute(text("EXEC sp_releaseapplock ..."), {...})
        conn.close()  # truly closes because of detach()
```

Alternative: use `@LockOwner='Transaction'` and wrap the entire run in one transaction. **Rejected** because the run can take minutes and we don't want to hold a transaction open that long. `Session` + `detach()` is the correct pattern.

For Postgres `pg_try_advisory_lock`, the same concern applies — the lock is session-scoped. Use `pg_advisory_unlock` explicitly in `finally` and `connection.detach()` for symmetry.

**Tests:** the test suite must include a "lock survives connection pool recycle" check — acquire a lock, close the connection, check out a fresh connection from the pool, attempt to acquire the same lock, assert it succeeds (proving the previous holder genuinely released).

## Step 4.3 — Real runner

**File:** `backend/app/scheduler/runner.py` (replace the PR 3 stub)

Implement spec §3.4 (the pseudocode) for real:

```python
import asyncio
from datetime import datetime, timezone
from uuid import UUID
from app.utils.constants import RUN_TIMEOUT_SECONDS, MAX_ATTACHMENT_BYTES
from app.utils.query_executor import execute_saved_query
from app.utils.result_export import render_csv, render_xlsx
from app.utils.email_sender import send_email
from app.utils.schedule_tokens import resolve_token, render_template

async def run_schedule(schedule_id: UUID, kind: str = "cron",
                       triggered_by: UUID | None = None) -> None:
    with per_schedule_lock(engine, schema, schedule_id) as got:
        if not got:
            _record_skipped(schedule_id, kind, triggered_by,
                            "previous run still in progress")
            return

        run_id = _create_run_row(schedule_id, kind, triggered_by, status="running")
        try:
            await asyncio.wait_for(
                _do_run(run_id, schedule_id, kind),
                timeout=RUN_TIMEOUT_SECONDS,
            )
        except asyncio.TimeoutError:
            _finalise_run(run_id, "failure", error="Run exceeded 5 minute timeout")
            _notify_failure(schedule_id, "Run exceeded 5 minute timeout")
        except OwnerLostAccessError as e:
            _finalise_run(run_id, "failure", error=str(e))
            _notify_admins_only(schedule_id, str(e))
        except Exception as e:
            _finalise_run(run_id, "failure", error=str(e))
            _notify_owner_or_admins(schedule_id, str(e))

async def _do_run(run_id: UUID, schedule_id: UUID, kind: str) -> None:
    schedule = _load_schedule(schedule_id)
    if schedule.is_deleted or not schedule.is_enabled:
        _finalise_run(run_id, "skipped", error="Schedule disabled or deleted")
        return

    saved_query = _load_saved_query(schedule.saved_query_id)
    _assert_owner_can_access(schedule.owner_user_id, saved_query)
        # raises OwnerLostAccessError if not

    now_utc = datetime.now(timezone.utc)
    resolved = _resolve_parameters(schedule, now_utc)

    # See spec §3.5 BEFORE writing this section. asyncio.wait_for cannot
    # cancel a thread spawned by asyncio.to_thread — the thread keeps
    # running until the DB returns. To bound the actual query execution
    # rather than just the await, set a query-level timeout via pyodbc
    # (`cursor.timeout = RUN_TIMEOUT_SECONDS` before .execute) or
    # psycopg's `statement_timeout` GUC. The wait_for wrapper still
    # exists as a backstop so the runner coroutine doesn't hang
    # indefinitely if the driver-level timeout fails for any reason.
    rows, columns, total, truncated = await asyncio.to_thread(
        execute_saved_query,
        engine, schema, saved_query.id,
        {p.name: p.resolved_value for p in resolved.values()},
        as_user_id=schedule.owner_user_id,
    )

    attachment = (
        render_csv(rows, columns) if schedule.attachment_format == "csv"
        else render_xlsx(rows, columns)
    )
    if len(attachment) > MAX_ATTACHMENT_BYTES:
        raise AttachmentTooLargeError(
            f"Attachment exceeds 15MB ({len(attachment)} bytes). "
            "Reduce row count or switch attachment format."
        )

    # Re-apply allowlist at run time (spec §10).
    smtp = _load_smtp_settings()
    recipients = _filter_allowlist(schedule.recipient_emails, smtp)
    if not recipients:
        raise NoRecipientsError(
            "All recipients blocked by allowlist (admin tightened domain "
            "restrictions after schedule creation)"
        )

    subject = render_template(schedule.email_subject, _resolved_for_template(resolved))
    body = render_template(schedule.email_body, _resolved_for_template(resolved))

    send_email(
        host=smtp.host, port=smtp.port, tls_mode=smtp.tls_mode,
        username=smtp.username, password=_load_smtp_password(),
        from_address=smtp.from_address, from_name=smtp.from_name,
        reply_to=smtp.reply_to_address,
        to=recipients, subject=subject, body=body,
        attachment_bytes=attachment,
        attachment_filename=f"{schedule.name}.{schedule.attachment_format}",
    )

    _finalise_run(
        run_id,
        "truncated" if truncated else "success",
        rows=len(rows), bytes=len(attachment),
        resolved=_resolved_for_storage(resolved),
        recipients_sent=recipients,
    )
    _update_schedule_last_run(schedule_id, "truncated" if truncated else "success")
```

The function is long but linear. Each `_helper` is small and named for what it does. The implementer should resist the urge to break the runner into more sub-functions than necessary — the linear flow is the easiest thing to debug at 3am.

## Step 4.4 — Notification helpers

**File:** `backend/app/scheduler/notifications.py` (new)

```python
def notify_failure_to_owner_or_admins(schedule_id, error_message): ...
def notify_failure_to_admins_only(schedule_id, error_message): ...
```

Each builds a plain-text email body containing schedule name, cron rendered via `cron-descriptor`, timestamp, error, and a link to the schedule detail page. Calls `email_sender.send_email`. **Failure notifications themselves do not retry** — if the notification fails, log at ERROR level and continue.

## Step 4.5 — `/run-now` endpoint

**File:** `backend/app/routes/schedule_routes.py`

Add `POST /api/schedules/{id}/run-now`. Owner-or-admin only. Calls the runner with `kind='manual'`. Audit-logged as `scheduled_query.manual_run`.

Refactor `/test` (added in PR 3) to call `runner.run_schedule(..., kind='test', triggered_by=current_user.id)` instead of duplicating the execution logic. The runner detects `kind='test'` and routes the email to the caller's address only.

## Step 4.6 — Daily housekeeping job

**File:** `backend/app/scheduler/housekeeping.py` (new)

```python
async def cleanup_old_runs() -> None:
    """
    Delete ScheduledQueryRun rows where:
      Status IN ('success', 'truncated', 'skipped')
      AND StartedAt < now() - 90 days
    Failure rows are kept indefinitely.
    """
```

Registered with the scheduler at startup using `CronTrigger(hour=3, minute=0, timezone=server_tz)`.

## Step 4.7 — Orphaned run cleanup

**File:** `backend/app/scheduler/housekeeping.py`

```python
async def cleanup_orphaned_runs() -> None:
    """
    Mark any ScheduledQueryRun row in 'running' state for >10 minutes
    as 'failure' with error 'interrupted by restart'. Send failure
    notifications. Runs once at scheduler startup.
    """
```

Registered as a one-shot job at scheduler startup (spec §3.7 step 3).

## Step 4.8 — Saved query / connection deletion handling

When the runner detects the saved query has `IsDeleted=1` or its connection has been removed, it raises `SavedQueryGoneError` which is caught at the top level and:
1. Sets `IsEnabled=0` on the schedule (auto-disable) **in the DB only**.
2. Sets `NeedsSync=1` on the schedule so the leader's next sync tick removes it from APScheduler. **Does not** call `sync.remove_job` directly — the runner may be executing on a non-leader worker (for `/run-now` and `/test`) where the scheduler instance doesn't exist. The same DB-only mutation pattern from Step 3.8 applies.
3. Logs `audit_log` entry `scheduled_query.auto_disabled`.
4. Sends failure notification to admins.

Spec §10 covers this; the implementer should match the table exactly.

**Worked-example reasoning for the DB-only pattern:** an admin uses `POST /run-now` from their browser → request lands on worker B → worker B is not the leader → worker B's runner detects the saved query has been soft-deleted → worker B sets `IsEnabled=0` and `NeedsSync=1` → returns 200 with the failure notification queued → leader worker A picks up the change on its next 60s sync tick and calls `remove_job` on its in-process APScheduler. No worker ever calls `remove_job` on a scheduler it doesn't own.

## Step 4.9 — Tests

**File:** `backend/tests/test_runner.py` (new)

- End-to-end against fake SMTP: create schedule with `{{start_of_week}}` parameter, run manually, verify email arrives, verify `ScheduledQueryRun` row, verify `ResolvedParameters` JSON shape from §5.3.
- Per-schedule lock contention: spawn two concurrent `run_schedule` calls for the same schedule, verify one writes `success` and the other writes `skipped`.
- Timeout: schedule a query that sleeps 10 minutes (mock the executor), verify the runner records `failure: Run exceeded 5 minute timeout`.
- Owner-lost-access: revoke owner's access mid-test, run, verify `failure` + admin notification.
- Saved query deleted: soft-delete the underlying saved query, run, verify `IsEnabled=0` + `audit_log` entry + admin notification.
- Allowlist tightened post-save: create schedule, enable allowlist excluding all current recipients, run, verify `failure: All recipients blocked by allowlist`.
- Attachment too large: mock `render_xlsx` to return 16MB, verify `failure` with the right error.

**File:** `backend/tests/test_runner_concurrency.py` (new)

Stress test the per-schedule lock with 5 concurrent invocations; only one should succeed, four should skip.

## Step 4.10 — Verify and PR

```bash
cd backend && ruff check . && ruff format --check . && pytest
```

PR description must state:
- Replaces the PR 3 runner stub with full execution.
- Cron-fired runs now actually execute queries and email results.
- `/run-now` endpoint added.
- Failure notifications, daily housekeeping, and orphaned-run cleanup all wired in.
- The frontend still doesn't have schedule pages (PR 5).
- Manual test plan: configure SMTP via PR 2 UI, create a schedule via curl/Postman, run-now via curl, verify email arrives, verify run history row.

---

# PR 5 — Schedule frontend

**Branch:** `feature/140-schedule-frontend`
**Estimated diff size:** ~1,500 lines (5 pages, 2 reusable components, route wiring, navigation)
**Goal:** Power Users can do everything via the UI that the API supports.

## Step 5.1 — Reusable components

**File:** `frontend/src/components/CronInput.jsx` (new)

Wraps a text input. As the user types, calls `cronstrue.toString(value, {throwExceptionOnParseError: false})` and shows the result below the input. If invalid, shows the error in red and disables form submission.

Has a preset dropdown above the input: "Hourly", "Daily", "Weekly", "Monthly", "Custom". Selecting a preset fills the input with the corresponding cron string (`0 * * * *`, `0 6 * * *`, `0 6 * * 1`, `0 6 1 * *`).

**File:** `frontend/src/components/EmailListInput.jsx` (new)

Chip-style multi-email input. User types an email and presses Enter (or comma, or paste with newlines/commas). Each email becomes a chip. Invalid emails are rejected with inline feedback. Uses native HTML email validation pattern.

## Step 5.2 — `SchedulesPage.jsx` (list)

**File:** `frontend/src/pages/SchedulesPage.jsx` (new)
**Route:** `/schedules`

Table columns:
- Name (link to detail)
- Saved query name
- Cron (rendered via `cronstrue`)
- Timezone
- Owner
- Last run (status badge + relative time, e.g. "Success — 2 hours ago")
- Next run
- Enabled (toggle, immediate API call on click)
- Actions menu (Edit, Run Now, Test, Disable/Enable, Delete)

"New schedule" button at the top, links to `/schedules/new`.

Empty state when there are no schedules: shows a CTA explaining what scheduling is and a link to create the first one.

If SMTP is not configured, shows a banner at the top: *"SMTP is not configured. Schedules cannot be created until an admin configures it."* with a link to `/settings/smtp` (visible only to admins).

## Step 5.3 — `ScheduleFormPage.jsx` (create/edit)

**File:** `frontend/src/pages/ScheduleFormPage.jsx` (new)
**Routes:** `/schedules/new`, `/schedules/:id/edit`

Five-step wizard with sidebar navigation. Each step is a separate React component co-located in the same file (or split into `frontend/src/pages/schedule-form/` if the file gets >600 lines).

1. **Pick saved query** — typeahead from `GET /api/queries`. Shows the query's parameters and connection.
2. **Schedule** — name, `<CronInput>`, timezone (defaults to `Intl.DateTimeFormat().resolvedOptions().timeZone`).
3. **Parameters** — one form field per saved-query parameter. Date params get the literal-vs-dynamic toggle.
4. **Recipients & delivery** — `<EmailListInput>`, attachment format radio, subject, body, with a "Preview rendered subject/body" panel.
5. **Review** — read-only summary of everything. Includes the **"Runs as: {owner_name} ({owner_role})"** line.

Save button only on step 5. Each step has Next / Back buttons; Next is disabled until the step's fields are valid.

## Step 5.4 — `ScheduleDetailPage.jsx`

**File:** `frontend/src/pages/ScheduleDetailPage.jsx` (new)
**Route:** `/schedules/:id`

Header: name, status badge, enable/disable toggle, edit, delete.

Below header: **"Runs as: {owner_name} ({owner_role})"** line.

Two prominently distinct buttons:
- **"Send test (to me)"** — calls `/api/schedules/:id/test`, shows toast on success/failure.
- **"Run now (sends to recipients)"** — visually distinct (different colour, e.g. amber). Opens a confirmation dialog showing the recipient list and the rendered subject before calling `/api/schedules/:id/run-now`. Visible only to owner-or-admin.

Tabs:
- **Configuration** — read-only summary of all schedule fields.
- **Run history** — paginated table from `/api/schedules/:id/runs?limit=50&offset=0`. Status badges. Click a row to expand and see `resolved_parameters` JSON, error message, recipients sent.

## Step 5.5 — Header navigation

**File:** `frontend/src/components/Header.jsx`

Add a "Schedules" link visible to PowerUser+ (matches the existing pattern for role-conditional nav items).

## Step 5.6 — Route registration

**File:** `frontend/src/App.jsx` (or wherever routes are wired)

```jsx
<Route path="/schedules" element={<RequireAuth roles={["PowerUser","Admin","SystemAdmin"]}><SchedulesPage /></RequireAuth>} />
<Route path="/schedules/new" element={<RequireAuth roles={["PowerUser","Admin","SystemAdmin"]}><ScheduleFormPage /></RequireAuth>} />
<Route path="/schedules/:id" element={<RequireAuth roles={["PowerUser","Admin","SystemAdmin"]}><ScheduleDetailPage /></RequireAuth>} />
<Route path="/schedules/:id/edit" element={<RequireAuth roles={["PowerUser","Admin","SystemAdmin"]}><ScheduleFormPage /></RequireAuth>} />
```

Note: route-level role check is advisory; the backend re-enforces. The owner-or-admin check on edit/delete is done in the component using the loaded schedule's `owner_user_id` against the current user.

## Step 5.7 — Verify and PR

```bash
cd frontend && npm run lint && npm run format:check
```

PR description must state:
- This PR adds the schedule list, create/edit, and detail UI. The feature is complete after this PR merges.
- Manual test plan: end-to-end through every workflow from the spec's user stories (§2).
- The user guide page (#140 wiki) is the only remaining deliverable; PR 6.

---

# PR 6 — User guide

**Branch:** `docs/140-scheduling-user-guide`
**Estimated diff size:** ~300 lines of markdown
**Goal:** End-user documentation on how to use scheduling. Per project memory, this is a recurring deliverable after each feature ticket lands.

**File:** `docs/wiki/scheduling-reports.md` (or wherever the wiki structure has settled by then)

Sections:
1. **What scheduling is** — one paragraph, with the framing "scheduled email is a *delivery* mechanism, the live UI is the source of truth".
2. **Configuring SMTP** (admin only) — walks through the SMTP settings page, the "Send test email" button, the SPF/DKIM warning, the allowlist toggle.
3. **Creating a schedule** — walks through the 5-step wizard with screenshots if available.
4. **Date tokens** — table of every token with a worked example.
5. **The "test" vs "run now" distinction** — explicitly explains why these are two buttons. References the customer-report use case from spec §2.
6. **"Runs as" — what masking applies to recipients** — explains that recipients see exactly what the schedule's owner would see in the live UI, including any column masking.
7. **Troubleshooting** — failed runs (where to find them, what the failure messages mean), the auto-disable behaviour, what to do if your SMTP host changes.
8. **Limits** — 10,000 row cap, 15MB attachment cap, 5-minute timeout, 90-day retention for successful runs.

PR description: "User guide for query scheduling (#140). Closes #140 entirely after merge. No code changes."

After merge, the implementer marks #140 as done in `PRODUCT_PLAN.md` and updates the next-actions list to reflect that Phase 3 is complete.

---

# Cross-cutting notes

## Order is mandatory

Each PR depends on the previous one's data model or interface. PR 4 cannot land without PR 3's tables and bootstrap. PR 5's frontend cannot land without PR 4's `/run-now` endpoint. **Do not start PR N+1 until PR N is merged to main**, otherwise you'll be rebasing constantly and the dependency surface gets confusing.

## Branch and review discipline (per CLAUDE.md)

- Every PR off a fresh branch from `main`, never piggybacking.
- Run lint, format check, and tests locally before pushing.
- Wait for the Claude review on each PR. Address every BLOCKING and WARNING; open `tech-debt` issues for any WARNING not fixed.
- Each PR's description must be self-contained for a reviewer with no codebase context. State the security model explicitly.
- Re-run all checks before pushing follow-up commits.
- Merge only after APPROVE on the most recent commit + CI green. Delete the branch after merge.
- Rebuild and verify both Docker containers after every merged PR (project memory: stale containers leave you on old code).

## What the implementer should *not* do

- Do not merge PRs in parallel. The order is sequential by design.
- Do not skip the refactor PR (PR 1) and inline the extraction in PR 4. The extraction is meaningful enough to warrant its own review.
- Do not add features beyond the spec. Spec §16 is the explicit out-of-scope list.
- Do not introduce a new dependency that isn't listed in this plan without raising it for discussion first.
- Do not skip the unit tests for `schedule_tokens.resolve_token` — DST behaviour is the most likely silent bug in this whole feature.
- Do not weaken the per-schedule lock under the assumption "concurrent runs are unlikely". They are exactly likely in the case where they cause the most harm: a developer manually testing run-now while a cron run is in progress.

## Open questions for the implementer to escalate, not silently decide

- If `ZoneInfo` is unavailable on a target Windows container despite `tzdata` being installed, escalate — do not fall back to `pytz` or hardcode UTC.
- If APScheduler's job persistence (`SqlAlchemyJobStore`) seems easier than the manual DB-table approach, escalate — the spec deliberately chose manual persistence so we own the query and don't depend on APScheduler internals.
- If a saved query happens to have a parameter type that wasn't in #16's original set, escalate — the validator needs to handle every type, not just the ones the implementer remembers.
- If the user guide structure conflicts with whatever wiki layout has been adopted by the time PR 6 lands, escalate — do not invent a new docs convention unilaterally.

---

**Status:** Plan complete. Ready for review.
