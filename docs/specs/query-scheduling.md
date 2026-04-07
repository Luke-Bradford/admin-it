# Query Scheduling — Design Spec

**Issue:** #140
**Phase:** 3 (data browser) — final remaining item
**Depends on:** #16 (saved query library), #15 (column masking), #14 (data export), #18 (audit log UI)
**Status:** Draft for review

---

## 1. Goal

Let Power Users schedule a saved query (#16) to run on a cron and email the result set as an attachment to a list of recipients. The live UI remains the source of truth for interactive runs; scheduling is a *delivery mechanism*, not a separate result store.

The single most important non-goal: **don't email the wrong thing to the wrong people**. Every design decision below favours predictability and explicit consent over flexibility or cleverness.

## 2. User stories

1. As a Power User, I create a "Weekly Sales — EMEA" schedule that runs every Tuesday at 06:00 Europe/London, with `start_date={{start_of_week}}` and `region="EMEA"`, and emails an XLSX attachment to `finance@acme.com` and `sales-lead@acme.com`.
2. As a Power User, I create a "Customer Statement — Acme Ltd" schedule that runs on the 1st of every month and emails a customer's data to `billing@acme-customer.com`. The customer is not an admin-it user.
3. As an Admin, I configure SMTP via a settings page, click "Send test email" to verify connectivity, and optionally restrict outbound mail to a list of allowed domains.
4. As a Power User, I click "Send test" on a schedule I'm building to receive a copy at *my own* address before turning it loose on real recipients.
5. As a Power User, I open a schedule and view its last 10 runs to confirm Tuesday's report actually went out.
6. As an Admin, when a scheduled run fails because the SQL errored or SMTP rejected the message, I receive a notification email with the error.

## 3. Architecture

### 3.1 Execution model

**APScheduler `AsyncIOScheduler`, running in-process inside the FastAPI backend.**

- Started in FastAPI's `lifespan` startup hook.
- Schedules are persisted in `[adm].[ScheduledQuery]` (the source of truth) and registered with APScheduler on startup. Schedule create/update/delete API calls also call `scheduler.add_job` / `modify_job` / `remove_job` so the running scheduler stays in sync without a restart.
- `coalesce=True` (collapse missed firings into one) and `max_instances=1` (no two instances of the same cron-fired job overlap) per schedule.
- A single **job runner function** is the heart of the feature. Both cron-fired and manual runs go through it.

### 3.2 Single-leader gate (multi-worker safety)

If `uvicorn` is ever started with `--workers > 1`, every worker would otherwise run its own scheduler and every email would arrive N times. To prevent this:

- At startup, the scheduler tries to acquire an application-level advisory lock keyed `admin_it_scheduler_leader`.
  - SQL Server: `sp_getapplock @Resource = 'admin_it_scheduler_leader', @LockMode = 'Exclusive', @LockOwner = 'Session', @LockTimeout = 0`.
  - Postgres: `SELECT pg_try_advisory_lock(hashtext('admin_it_scheduler_leader'))`.
- Only the worker that acquires the lock starts APScheduler. Others log "scheduler-leader lock not acquired, scheduler disabled in this worker" and continue serving API requests normally.
- The lock is held for the lifetime of the worker process. If the leader dies, another worker picks it up on its next leader-check tick (every 60s).
- API mutations (create/update/delete schedule) are sent to APScheduler via an in-memory queue that the leader worker drains. Non-leader workers write to the queue but don't process it. *Implementation simplification for v1: instead of a queue, non-leader workers just write to the DB and rely on the leader to pick up changes on its 60s leader-check tick.* Slightly slower propagation, dramatically simpler. Document this lag explicitly.

### 3.3 Per-run concurrency lock

`max_instances=1` only prevents APScheduler from firing two cron-triggered jobs of the same schedule. Manual `run-now` calls go through the route handler, not APScheduler — so without further protection, a click during an in-flight cron run could produce two concurrent runs.

The runner takes a **per-schedule application lock** at entry:

- SQL Server: `sp_getapplock @Resource = 'scheduled_query:{schedule_id}', @LockMode = 'Exclusive', @LockOwner = 'Session', @LockTimeout = 0`.
- Postgres: `pg_try_advisory_lock(hashtext('scheduled_query:{schedule_id}'))`.

Acquired in a tiny dedicated transaction, then released after the run completes. The runner uses other connections for the actual query and email work — the lock connection is just for the lock. If the lock can't be acquired, the runner writes a `skipped` row to `ScheduledQueryRun` (with `error_message='Previous run still in progress'`) and returns. Both cron-fired and manual paths are subject to this gate.

### 3.4 Job runner function (pseudocode)

```
def run_schedule(schedule_id, kind="cron"):
    with per_schedule_lock(schedule_id) as got:
        if not got:
            record_skipped(schedule_id, kind, "previous run still in progress")
            return

        run = create_run_row(schedule_id, kind, status="running")
        try:
            with timeout(5_minutes):  # see §3.5 for the concrete mechanism
                schedule = load_schedule(schedule_id)
                if schedule.is_deleted or not schedule.is_enabled:
                    return

                saved_query, connection = load_saved_query(schedule.saved_query_id)
                assert_owner_can_access(schedule.owner_id, saved_query, connection)

                resolved = resolve_parameters(schedule, now=datetime.now(tz=UTC))
                rows, truncated = execute_saved_query(
                    saved_query, connection, resolved, as_user=schedule.owner_id
                )
                attachment = render_attachment(rows, schedule.attachment_format)
                if len(attachment) > MAX_ATTACHMENT_BYTES:
                    raise AttachmentTooLargeError(...)

                send_email(
                    smtp=load_smtp_config(),
                    to=schedule.recipient_emails,
                    subject=render_template(schedule.subject, resolved),
                    body=render_template(schedule.body, resolved),
                    attachment=attachment,
                    attachment_name=...,
                )
                finalise_run(run, status="truncated" if truncated else "success",
                             rows=len(rows), bytes=len(attachment),
                             resolved=resolved)
        except OwnerLostAccessError as e:
            finalise_run(run, status="failure", error=str(e))
            notify_admins_only(schedule, e)
        except Exception as e:
            finalise_run(run, status="failure", error=str(e))
            notify_owner_or_admins(schedule, e)
```

### 3.5 Per-run timeout mechanism

APScheduler does not enforce a timeout on `AsyncIOScheduler` jobs. The 5-minute cap is enforced explicitly by the runner via **`asyncio.wait_for(coro, timeout=RUN_TIMEOUT_SECONDS)`** wrapping the inner work coroutine. On timeout, `asyncio.TimeoutError` is raised and the runner records `Status='failure'` with `ErrorMessage='Run exceeded 5 minute timeout'`.

Important consequences of this choice:

- **The DB query itself does not get cancelled by `wait_for`.** `pyodbc`/`psycopg` cursors block in C code that doesn't release the GIL cleanly to `asyncio`. The query executor is therefore wrapped in `asyncio.to_thread(...)` so the timeout aborts the *await* but the underlying cursor keeps running until the DB returns. This is acceptable because the connection is local to the runner thread and is closed immediately after the timeout, which causes most drivers to issue a session-level cancel on connection drop.
- For SQL Server, an explicit `KILL` of the rogue session is **out of scope for v1** — it requires elevated DB permissions admin-it doesn't otherwise need. Runaway queries will eventually clear when the connection times out at the driver level.
- Documented as a known limitation in the user guide: "Schedules that consistently hit the 5-minute timeout should be optimised at the SQL level rather than left to time out repeatedly."

## 4. Data model

All tables live in the configurable `[adm]` schema (resolved from `config.schema` at startup; `[adm]` is illustrative). Both SQL Server (`spDeployCoreSchema.sql`) and Postgres (`deploy_core_schema_postgres.sql`) variants ship together per the existing dual-backend pattern from #75/#76.

### 4.1 `[adm].[ScheduledQuery]`

| Column | Type | Notes |
|---|---|---|
| `ScheduleId` | `UNIQUEIDENTIFIER PK` | |
| `SavedQueryId` | `UNIQUEIDENTIFIER FK → SavedQuery(SavedQueryId)` | RESTRICT delete; cascade-disable handled at app level. |
| `Name` | `NVARCHAR(200) NOT NULL` | No uniqueness constraint — duplicates allowed (see §10.e). |
| `OwnerUserId` | `UNIQUEIDENTIFIER FK → users(UserId)` NOT NULL | Effective user for run-time permissions. |
| `CronExpression` | `NVARCHAR(100) NOT NULL` | Standard 5-field cron. Validated via `apscheduler.triggers.cron.CronTrigger.from_crontab` before storage. |
| `Timezone` | `NVARCHAR(64) NOT NULL` | IANA name (e.g. `Europe/London`). Defaults to server tz at API layer if caller omits. |
| `IsEnabled` | `BIT NOT NULL DEFAULT 1` | |
| `RecipientEmails` | `NVARCHAR(MAX) NOT NULL` | JSON array of email strings. Min length 1 enforced at API layer. |
| `AttachmentFormat` | `NVARCHAR(10) NOT NULL` | CHECK `IN ('csv', 'xlsx')`. |
| `EmailSubject` | `NVARCHAR(500) NOT NULL` | Supports the same date tokens as parameters. |
| `EmailBody` | `NVARCHAR(MAX) NOT NULL` | Plain text, supports tokens. |
| `LastRunAt` | `DATETIME2 NULL` | Bookkeeping. Updated by runner only. Manual `/test` runs do not update this. |
| `LastRunStatus` | `NVARCHAR(20) NULL` | Same. |
| `NextRunAt` | `DATETIME2 NULL` | Bookkeeping; updated when the scheduler computes the next firing. |
| `CreatedAt`, `CreatedBy`, `UpdatedAt`, `UpdatedBy`, `IsDeleted` | standard | Soft-delete; temporal table on SQL Server, audit-trigger pattern on Postgres. |

### 4.2 `[adm].[ScheduledQueryParameter]`

| Column | Type | Notes |
|---|---|---|
| `ScheduleParameterId` | `UNIQUEIDENTIFIER PK` | |
| `ScheduleId` | `UNIQUEIDENTIFIER FK → ScheduledQuery` ON DELETE CASCADE | |
| `ParameterName` | `NVARCHAR(100) NOT NULL` | Matches `SavedQueryParameter.Name` at create time. Cross-checked at run time. |
| `ValueLiteral` | `NVARCHAR(MAX) NULL` | Verbatim string (saved-query parameter values are always strings). |
| `ValueToken` | `NVARCHAR(50) NULL` | One of `ALLOWED_TOKENS` (see §5). NULL when literal. |
| | | CHECK: exactly one of `ValueLiteral`/`ValueToken` is non-null. |
| | | UNIQUE `(ScheduleId, ParameterName)`. |

### 4.3 `[adm].[ScheduledQueryRun]`

| Column | Type | Notes |
|---|---|---|
| `RunId` | `UNIQUEIDENTIFIER PK` | |
| `ScheduleId` | `UNIQUEIDENTIFIER FK → ScheduledQuery` ON DELETE CASCADE | |
| `Kind` | `NVARCHAR(10) NOT NULL` | CHECK `IN ('cron', 'manual', 'test')`. |
| `StartedAt` | `DATETIME2 NOT NULL` | UTC. |
| `FinishedAt` | `DATETIME2 NULL` | UTC. NULL while running. |
| `DurationMs` | `INT NULL` | |
| `Status` | `NVARCHAR(20) NOT NULL` | CHECK `IN ('running','success','failure','skipped','truncated')`. |
| `RowCount` | `INT NULL` | |
| `BytesSent` | `INT NULL` | |
| `ResolvedParameters` | `NVARCHAR(MAX) NULL` | JSON; see §5.2. |
| `RecipientEmailsSent` | `NVARCHAR(MAX) NULL` | JSON array. For `test` kind, this is `[caller_email]`. |
| `TriggeredByUserId` | `UNIQUEIDENTIFIER NULL` | NULL for cron, populated for manual/test. |
| `ErrorMessage` | `NVARCHAR(MAX) NULL` | |
| | | INDEX `(ScheduleId, StartedAt DESC)` for "last N runs" queries. |

### 4.4 `[adm].[Settings]`

Generic key/value store for app-level settings (this ticket adds the SMTP keys; future tickets can reuse the table). The SMTP password is **not** stored here — it lives in `[adm].[Secrets]` alongside `JWT_SECRET`.

| Column | Type | Notes |
|---|---|---|
| `SettingKey` | `NVARCHAR(100) PK` | |
| `SettingValue` | `NVARCHAR(MAX) NOT NULL` | JSON-encoded. |
| `UpdatedAt`, `UpdatedBy` | standard | |

Keys added by this ticket:

| Key | Value type | Notes |
|---|---|---|
| `smtp.host` | string | |
| `smtp.port` | int | |
| `smtp.tls_mode` | enum | `none`, `starttls`, `tls`. |
| `smtp.username` | string | Optional; some relays accept anonymous. |
| `smtp.from_address` | string | |
| `smtp.from_name` | string | Optional display name. |
| `smtp.reply_to_address` | string | Optional; defaults to `from_address` when sending if unset. |
| `smtp.allowlist_enabled` | bool | When false, all domains accepted (default). |
| `smtp.allowed_domains` | string[] | Used only when `allowlist_enabled=true`. |

## 5. Date tokens

### 5.1 Allowed token set

A single constant `ALLOWED_TOKENS` in `backend/app/utils/schedule_tokens.py`:

```
today
yesterday
start_of_week        # Monday-based
end_of_week          # Sunday
start_of_month
end_of_month
start_of_last_month
end_of_last_month
```

The API allowlists `value_token` against this constant via `Literal[...]` on the Pydantic model — never against a free-form string. New tokens require a code change and a test, by design.

### 5.2 Resolution

`resolve_token(token: str, now_utc: datetime, schedule_tz: ZoneInfo) -> date`

- `now_utc` is the only wall-clock value entering the function. Everything else is derived from `schedule_tz`.
- All "start of X" tokens return the date in `schedule_tz`, not in UTC.
- DST behaviour: `start_of_week` on a DST-spring-forward Sunday returns the Monday date in `schedule_tz`, even if "midnight Monday" doesn't exist as a moment. The function operates on `date` objects, not `datetime`s, so DST gaps don't apply.

### 5.3 Resolved parameter snapshot format

Stored in `ScheduledQueryRun.ResolvedParameters`:

```json
{
  "_resolved_at": "2026-04-07T06:00:00+01:00",
  "start_date": { "source": "token:start_of_week", "value": "2026-04-06" },
  "region":     { "source": "literal",             "value": "EMEA" }
}
```

The `_resolved_at` value is in `schedule_tz`. This format gives the debugger both the *intent* (token) and the *outcome* (value) for every parameter, which is the question that comes up when investigating "why did last Tuesday's report show the wrong week?"

### 5.4 Email subject and body templates

`EmailSubject` and `EmailBody` go through the same `resolve_token` mechanism via a tiny `render_template(text, resolved)` helper that does literal string replacement of `{{token_name}}` substrings using the resolved values from the parameter snapshot. Tokens that aren't in `ALLOWED_TOKENS` are left as literal text — no error, no execution. (Refusing would be unfriendly to users who legitimately want `{{` in their email body.)

## 6. API

All routes in a new file `backend/app/routes/schedule_routes.py`. Every route uses `Depends(verify_token)` and has an explicit role check as the first line of the handler. The role constants follow the existing `POWER_AND_ABOVE = {"PowerUser", "Admin", "SystemAdmin"}` and `ADMIN_AND_ABOVE = {"Admin", "SystemAdmin"}` pattern from `query_routes.py`.

### 6.1 Schedule CRUD

| Route | Auth | Notes |
|---|---|---|
| `GET /api/schedules` | PowerUser+ | Lists all non-deleted schedules. Power users see all. |
| `POST /api/schedules` | PowerUser+ | Body: name, saved_query_id, cron, timezone, recipients[], attachment_format, subject, body, parameters[]. Validates everything in §6.4. Caller must have access to the saved query. Response includes `scheduler_registered: bool` — `true` if the schedule is live in APScheduler now, `false` if it was written to the DB but the leader worker has not yet picked it up (see §3.2; up to 60s on multi-worker deployments). Same field returned by PATCH/enable/disable. |
| `GET /api/schedules/{id}` | PowerUser+ | Returns schedule + parameters + last 10 runs. |
| `PATCH /api/schedules/{id}` | Owner-or-Admin+ | Partial update. `parameters` is full replacement when provided. PATCH with all-None body returns **422**, never silent 2xx. |
| `DELETE /api/schedules/{id}` | Owner-or-Admin+ | Soft-delete (`IsDeleted=1`); calls `scheduler.remove_job`. |
| `POST /api/schedules/{id}/enable` | Owner-or-Admin+ | Sets `IsEnabled=1`; re-registers with scheduler. |
| `POST /api/schedules/{id}/disable` | Owner-or-Admin+ | Sets `IsEnabled=0`; removes from scheduler. |

### 6.2 Manual triggers — two routes, deliberately

| Route | Auth | Sends to | Notes |
|---|---|---|---|
| `POST /api/schedules/{id}/test` | PowerUser+ (must be able to see the schedule) | **Caller's own email only** | `Kind='test'`, does not update `LastRunAt`. Audit-logged as `scheduled_query.test`. |
| `POST /api/schedules/{id}/run-now` | Owner-or-Admin+ | **Real configured recipients** | `Kind='manual'`, updates `LastRunAt`. Audit-logged as `scheduled_query.manual_run`. |

The split is the most important UX choice in this design. Reasons documented in §11.

### 6.3 Run history

| Route | Auth | Notes |
|---|---|---|
| `GET /api/schedules/{id}/runs?limit=50&offset=0` | PowerUser+ | Newest first. |

### 6.4 SMTP settings

| Route | Auth | Notes |
|---|---|---|
| `GET /api/settings/smtp` | Admin+ | Returns config without password. Includes `password_set: bool`. |
| `PUT /api/settings/smtp` | Admin+ | Updates non-password fields. |
| `PUT /api/settings/smtp/password` | Admin+ | Writes to `[adm].[Secrets]`. Write-only. |
| `POST /api/settings/smtp/test` | Admin+ | Body: `{ "to": "..." }`. Sends a fixed test message. Returns the SMTP server's response or the error. |

### 6.5 Validation rules (POST/PATCH `/api/schedules`)

1. `cron` parses via `CronTrigger.from_crontab(expr, timezone=tz)`.
2. `timezone` is a known `ZoneInfo` name.
3. `recipients` is non-empty; every element is a syntactically valid email.
4. If `smtp.allowlist_enabled` is true, every recipient's domain is in `smtp.allowed_domains`.
5. SMTP is configured (`smtp.host` is set and password is set). Otherwise 422 with a clear message.
6. Caller has access to the saved query under their own role (so a Power User can't schedule a query they can't run themselves).
7. Owner (defaults to caller on create, may differ on admin update) has access to the saved query and its connection.
8. Every required parameter of the saved query is present in `parameters[]`. Extras → 422.
9. For each parameter: exactly one of `value_literal` / `value_token` is set. `value_token` (if present) is in `ALLOWED_TOKENS`. `value_token` is only allowed for `date`-typed parameters; for other types, 422.
10. `attachment_format` is in `Literal["csv", "xlsx"]`.

## 7. Frontend

### 7.1 New pages and routes

| Path | Component | Auth |
|---|---|---|
| `/schedules` | `SchedulesPage` | PowerUser+ |
| `/schedules/new` | `ScheduleFormPage` (mode=create) | PowerUser+ |
| `/schedules/:id` | `ScheduleDetailPage` | PowerUser+ |
| `/schedules/:id/edit` | `ScheduleFormPage` (mode=edit) | Owner-or-Admin+ |
| `/settings/smtp` | `SmtpSettingsPage` | Admin+ |

### 7.2 SchedulesPage (list)

Table columns: Name, Saved Query (link), Cron (rendered via `cronstrue`, e.g. "At 06:00 AM, only on Tuesday"), Timezone, Owner, Last Run (status badge + timestamp), Next Run, Enabled (toggle), Actions menu (Edit, Delete, Run Now, Test, Disable/Enable).

"New schedule" button at the top. Row click → detail page.

### 7.3 ScheduleFormPage

Five-step wizard. Step navigation in a sidebar; "Save" only available on the final review step.

1. **Pick saved query** — typeahead from `GET /api/queries`. Shows the query's parameters and the connection it targets.
2. **Schedule** — name, cron expression (with preset dropdown for hourly/daily/weekly/monthly + custom), timezone (defaults to browser tz). Live preview rendered via `cronstrue` as user types.
3. **Parameters** — one form field per saved-query parameter, typed to its declared type. Date parameters get an extra toggle: "Literal date" (date picker) or "Dynamic" (dropdown of allowed tokens with human descriptions).
4. **Recipients & delivery** — multi-input email field (paste-multiple, chip display, syntactic validation), attachment format radio, email subject, email body. "Preview rendered subject/body for the next run" panel that shows `{{token}}` substitution against a hypothetical "now".
5. **Review** — read-only summary of everything. **Owner display:** "Runs as: {owner_name} ({owner_role})" — explicitly tells the creator that masking and access apply to this user, not the recipients.

### 7.4 ScheduleDetailPage

- Header: name, status badge, enable/disable toggle, edit, delete.
- **"Send test (to me)" button** — calls `/test`, shows toast on success.
- **"Run now" button** — separate, visually distinct (different colour), opens a confirmation dialog showing the recipient list before calling `/run-now`. Owner-or-admin only; hidden otherwise.
- "Runs as: {owner_name} ({owner_role})" line below the header.
- Tabs:
  - **Configuration** — read-only summary.
  - **Run history** — paginated table with status badges. Click a row to expand and see resolved parameters JSON, error message, recipients sent.

### 7.5 SmtpSettingsPage

- Form: host, port, TLS mode, username, from address, from name, reply-to address.
- Toggle: "Restrict outbound mail to allowed domains". When on, exposes the allowed-domains list editor.
- Separate "Set password" panel — write-only field. Existing password indicated by a "Password is set" badge.
- "Send test email" button at the bottom — prompts for a recipient address, calls `/api/settings/smtp/test`, shows the SMTP response.
- Inline info note: *"If you're sending to recipients outside your organisation, ensure your DNS has SPF and DKIM records authorising this SMTP host to send as the From address, or recipients may filter messages as spam."*

## 8. Code organisation

### 8.1 New backend files

- `backend/app/routes/schedule_routes.py` — schedule CRUD, run history, manual triggers.
- `backend/app/routes/settings_routes.py` — SMTP settings (also a home for future settings).
- `backend/app/models/schedule.py` — Pydantic models. All bounded-set fields use `Literal[...]`.
- `backend/app/utils/schedule_tokens.py` — `ALLOWED_TOKENS`, `resolve_token`, `render_template`.
- `backend/app/utils/email_sender.py` — `send_email(smtp_config, to, subject, body, attachment_bytes, attachment_filename)`. Uses stdlib `smtplib` + `email.message.EmailMessage`.
- `backend/app/utils/query_executor.py` — **extracted from `query_routes.py`**. The "execute saved query as user X" logic, parameter binding, masking, row cap. Reused by both the existing route and the scheduler. *This refactor is part of the ticket because the scheduler can't import a route handler.*
- `backend/app/utils/result_export.py` — **extracted from `data_routes.py` and `query_routes.py`**. CSV/XLSX rendering with the `MAX_EXPORT_ROWS` cap. Eliminates the duplicated constant in passing.
- `backend/app/scheduler/__init__.py` — APScheduler bootstrap, leader-lock acquisition, job runner, sync between DB and APScheduler.
- `backend/app/scheduler/runner.py` — `run_schedule(schedule_id, kind)` job runner function.

### 8.2 New frontend files

- `frontend/src/pages/SchedulesPage.jsx`
- `frontend/src/pages/ScheduleFormPage.jsx`
- `frontend/src/pages/ScheduleDetailPage.jsx`
- `frontend/src/pages/SmtpSettingsPage.jsx`
- `frontend/src/components/CronInput.jsx` — wraps a text input with `cronstrue` live preview.
- `frontend/src/components/EmailListInput.jsx` — chip-style multi-email input.

### 8.3 New dependencies

- Backend: `apscheduler`, `cron-descriptor` (human-readable cron in failure emails), `tzdata` (Windows containers don't ship IANA tz data by default).
- Frontend: `cronstrue` (~10KB, MIT).

### 8.4 New constants

```python
# backend/app/utils/constants.py (or co-located with the relevant module)
MAX_EXPORT_ROWS = 10_000           # consolidated from data_routes.py / query_routes.py
MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024
RUN_TIMEOUT_SECONDS = 5 * 60
SUCCESS_RETENTION_DAYS = 90
SCHEDULER_LEADER_LOCK_KEY = "admin_it_scheduler_leader"
ORPHANED_RUN_THRESHOLD_MINUTES = 10
LEADER_CHECK_INTERVAL_SECONDS = 60
```

## 9. Security model

Authentication ≠ authorisation. Every route is verified twice — once for a valid JWT, once for the right role. The matrix in §6 is the source of truth for who can do what.

- **No raw SQL injection.** Cron strings are validated by parsing through APScheduler before storage. Schedule names, recipient emails, parameter values, and email body/subject are all stored as bind-parameter values, never f-string-interpolated. Schema name (`config.schema`) is the *only* identifier interpolated into SQL anywhere in the new code, consistent with the rest of the codebase.
- **Allowlist enforcement is server-side.** The frontend hides UI for blocked domains, but the backend re-validates on every create/update. Client-side checks are advisory only.
- **SMTP password never returned.** `GET /api/settings/smtp` returns `password_set: bool` only. Password is read from `[adm].[Secrets]` at send time, the same way `JWT_SECRET` is loaded.
- **Owner-effective permissions at run time, not cached.** The runner re-checks the owner's access to the saved query and its connection on every run. If revoked, the run fails loudly and admins are notified.
- **Run-as semantics.** Column masking from #15 is applied under the *owner's* role at run time. If an Admin creates a schedule and is later demoted, future runs return the more-masked result. Ownership reassignment by an admin (PATCH) takes effect on the next run. **Recipients are not admin-it users and have no role** — they see exactly what the owner would see in the live UI. This is the safest possible default and is explicitly documented in the user guide.
- **Audit trail.** `audit_log` entries for: `scheduled_query.create`, `.update`, `.delete`, `.enable`, `.disable`, `.test`, `.manual_run`, `.auto_disabled`, `smtp_settings.update`, `smtp_settings.password_rotated`. Run *firings* (cron-triggered) do **not** go to `audit_log` — they go to `ScheduledQueryRun` per §4.3. The split is deliberate: `audit_log` is for user actions, `ScheduledQueryRun` is for operational telemetry.
- **Email body / subject token rendering.** Allowlisted via `ALLOWED_TOKENS`. Anything that looks like `{{...}}` but isn't in the list is left as a literal — no error, no execution.

## 10. Edge cases

| Case | Behaviour |
|---|---|
| Saved query soft-deleted while a schedule references it | At next run, runner detects this and writes `failure: saved query no longer exists`. Schedule is auto-disabled (`IsEnabled=0`), `audit_log` entry `scheduled_query.auto_disabled`, failure notification sent. Schedule itself is not deleted — admin can repoint by editing. |
| Saved query's connection deleted | Same path as above — `auto_disabled`, failure notification. |
| Saved query parameters changed (renamed/removed/new required) | Runner cross-references frozen `ScheduledQueryParameter` rows against current `SavedQueryParameter` rows. Missing required → fail with "Saved query parameter X is missing from this schedule. Edit the schedule to add it.". Extra frozen params (no longer on the query) → silently ignored. Schedule is *not* auto-disabled in this case — the user might fix it on the saved-query side. |
| Container restart mid-run | The in-flight `ScheduledQueryRun` row is left in `running`. On scheduler-leader startup, the leader sweeps `WHERE Status='running' AND StartedAt < now() - 10 minutes` and marks them `failure: interrupted by restart`. Failure notification sent. |
| Owner deactivated or deleted | Schedule is *not* auto-deleted. Next run records `failure: owner no longer has access`. Notification goes to all admins (the owner is gone). Admin can reassign owner via PATCH. |
| Multi-worker uvicorn (`--workers > 1`) | Scheduler-leader gate (§3.2) ensures only one worker schedules. Others log and continue serving the API. |
| Cron expression that fires very frequently (`* * * * *`) | Allowed. The 5-min run timeout + per-schedule lock are the natural backstop. UI displays a warning when cron fires more often than once per 15 minutes. |
| SMTP not configured at create time | Schedule create/update returns 422 with a clear message and a link to the SMTP settings page. List/get/delete still work. UI shows a banner on the schedules list page. |
| SMTP password rotation race | A run that hits SMTP during a rotation gets `failure: smtp auth error`. Normal failure path; no special handling. |
| Empty result set | Send the email anyway. Body notes "0 rows". Attachment is still produced (empty CSV / XLSX with headers). Justification: silent-on-zero is a footgun — a broken query returning zero rows is indistinguishable from a healthy query returning zero rows. |
| Result truncated to `MAX_EXPORT_ROWS` | `Status='truncated'`. Attachment contains the 10k rows. Body adds "Result truncated at 10,000 rows. View the full result at {link}." Run still counts as delivered. |
| Attachment exceeds `MAX_ATTACHMENT_BYTES` after rendering | `Status='failure'`. `ErrorMessage='Attachment exceeds 15MB ({n} bytes). Reduce row count or switch attachment format.'`. Failure notification sent. |
| Concurrent run already in progress when next tick fires | Per-schedule lock (§3.3) is unavailable. Writes `Status='skipped'`, no email sent. Visible in run history. |
| Recipient list rendered empty by allowlist tightening | A schedule saved while `smtp.allowlist_enabled=false` may have recipients on a domain that an admin later restricts. The runner re-applies the current allowlist and filters recipients before sending. If the filter empties the list → `failure: all recipients blocked by allowlist (admin tightened domain restrictions after schedule creation)`. Failure notification goes to the schedule owner. The schedule is **not** auto-disabled — fixing it is a one-line edit in the SMTP settings or the schedule recipients. |
| Manual `/test` triggered by a user with no email address on file | 422 — caller has no email to send to. |

### 10.e Naming

No uniqueness constraint on `Name`. People will want "Daily Sales — UK" and "Daily Sales — US" and may forget to differentiate. Adding a constraint creates friction without preventing a real bug, and soft-delete makes uniqueness messy anyway.

## 11. The `/test` vs `/run-now` split — rationale

The single most dangerous thing this feature can do is email an external customer the wrong thing. A test-self-only default is the right call because:

1. The cost of accidentally sending a real email to a customer is high (reputation, potentially legal). The cost of having to click a different button to do a real send is one click.
2. The URL itself communicates intent to anyone reading the route definition. A reviewer doesn't need to read a body schema to understand that `/test` cannot reach customers.
3. Permissions diverge cleanly: anyone PowerUser+ can test their own work; only the owner or admin can fire a real send.
4. A typo in a JSON body should not result in an email going to a customer. Routes are harder to typo than booleans.
5. Every mature reporting tool I've used (Looker, Metabase, Mode) handles this with two distinct actions, and the reason they all do is because someone got burned doing it the other way.

## 12. Failure notification

When a run finishes with `Status='failure'`:

1. If the failure is `OwnerLostAccessError` (owner deactivated, demoted, or lost access to the saved query/connection), notify **all admins**, not the owner. The owner can't act on the failure.
2. Otherwise notify the **schedule owner** by email. If the owner has no email, fall back to all admins.
3. Notification is a plain-text email with: schedule name, cron (rendered via `cron-descriptor`), timestamp, error message, and a link to the schedule detail page.
4. Failure notifications themselves do not retry. If they fail to send, the run is still marked `failure` and the SMTP error is logged at `ERROR` level. We don't loop-on-loop here.

## 13. Retention

A daily housekeeping job (`run_history_cleanup`) registered with the same scheduler:

- Runs at 03:00 in the server's timezone.
- Deletes `ScheduledQueryRun` rows where `Status IN ('success','truncated','skipped')` AND `StartedAt < now() - 90 days`.
- **Never deletes `failure` rows.** They accumulate until the schedule is deleted (which cascades).

`truncated` is bundled with `success` for retention purposes as a deliberate choice: a truncated run *did* deliver an email and is not an actionable failure. The tradeoff is that an admin investigating "why did the March report only show 10k rows?" six weeks later will still see the run row (90 days > 6 weeks), but a year later they will not. If long-term truncation visibility becomes important, the right fix is to add a separate `truncated_retention_days` constant — not to keep all truncated runs forever.

The 90-day constant lives in `constants.py` and is not configurable in v1. When a real user asks for a different value, move it to `[adm].[Settings]`.

## 14. Testing strategy

### 14.1 Unit tests

- `schedule_tokens.resolve_token` — every token, around DST boundaries (spring forward / fall back), around month boundaries, around year boundaries, in multiple timezones (Europe/London, America/New_York, Pacific/Auckland). Pure-function, no DB.
- `render_template` — substitutes known tokens, leaves unknown `{{...}}` as literal, handles repeated tokens, handles tokens at start/middle/end of string.
- Cron expression validation — valid cron passes, invalid cron rejected with the parser's error message preserved.
- `result_export` — empty result, single row, exactly `MAX_EXPORT_ROWS`, `MAX_EXPORT_ROWS + 1` (truncation flag set).
- `email_sender` — uses `aiosmtpd` (or stdlib `smtpd` in a thread) as a fake server. Asserts the email content, attachment filename, MIME structure, `Reply-To` header presence/fallback.

### 14.2 Integration tests

- `schedule_routes` full CRUD as PowerUser, Admin, regular User. Role-boundary tests: regular User → 403 on every route. Owner-or-admin enforcement on PATCH/DELETE/run-now. Allowlist enforcement on create/update.
- `/test` vs `/run-now` — verify `/test` only emails the caller, `/run-now` only emails configured recipients, and that the wrong-role caller gets 403.
- Runner end-to-end: create a schedule against a fake SMTP, manually invoke the runner, verify a `ScheduledQueryRun` row is written and the email arrives at the fake server with the expected content.
- Per-schedule lock contention: simulate two concurrent runner invocations, verify one writes `success` and the other writes `skipped`.
- Auto-disable on deleted saved query: delete the underlying saved query, run the runner, verify `IsEnabled=0` and `audit_log` entry.
- Owner-lost-access path: revoke owner's access to the saved query's connection, run the runner, verify failure status and admin notification.

### 14.3 Manual test plan (in PR description)

1. Configure SMTP via the settings page; click "Send test email"; verify arrival.
2. Create a daily schedule for a saved query with a date parameter using `{{start_of_week}}`.
3. Click "Send test (to me)" — verify arrival at own address; verify the schedule's `LastRunAt` is *not* updated.
4. Click "Run now"; confirm the dialog shows the recipient list; verify arrival at recipients; verify `LastRunAt` *is* updated.
5. Disable the schedule; verify the toggle, verify no scheduled fire occurs at the next cron tick.
6. Re-enable; edit the recipients; click test again.
7. Delete the schedule; verify it disappears from the list and APScheduler.

## 15. Documentation deliverables

- `docs/specs/query-scheduling.md` — this document.
- `docs/plans/query-scheduling.md` — implementation plan written by the writing-plans skill in a follow-up session, after this spec is approved and merged.
- User guide page: `docs/wiki/scheduling-reports.md` (or equivalent under whatever wiki structure lands first) — drafted after the implementation ticket merges, per project memory. Covers: creating a schedule, the date tokens, the "test vs run-now" distinction, troubleshooting failed runs, the masking-as-owner behaviour, the SPF/DKIM caveat for external recipients.

## 16. Out of scope (explicit YAGNI)

- HTML email bodies / inline rendering — CSV/XLSX attachments only.
- Multiple attachments per email / multiple queries per schedule.
- Conditional sending ("only if rows > 0", "only on weekdays beyond what cron expresses").
- Approval workflows for schedule creation.
- Per-recipient personalisation / templating.
- Storing scheduled-query results in admin-it for trend analysis.
- Slack / Teams / webhook delivery — email only in v1.
- Configurable retention or per-schedule timeout overrides — hardcoded constants in v1.
- Horizontal scaling beyond the single-leader gate.
- "Pause all schedules" admin button — disable individually in v1.
- A "preview the email with real data" endpoint — preview is subject/body string-rendering only; the data isn't fetched until the real run.
- Schedule templates / cloning — pure UI feature, deferrable, no data-model implications.
- Metrics / Prometheus endpoint — inconsistent with the rest of the codebase, defer until observability becomes a project-wide concern.

## 17. Open questions

None at the time of writing. All decisions in this spec have been explicitly chosen during brainstorming.
