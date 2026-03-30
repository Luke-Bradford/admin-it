# app/routes/data_routes.py
#
# Phase 3 — Data browser (#13) and Data export (#14).
#
# Security model:
#   - All endpoints require a valid JWT (verify_token).
#   - Connection access checked via the same _require_connection_access()
#     helper from browse_routes (Admin sees all; others need UserConnectionAccess).
#   - schema, table, and column identifiers are NEVER interpolated directly.
#     They are first validated against INFORMATION_SCHEMA on the target DB;
#     only identifiers that appear there are bracket-quoted and used in SQL.
#   - Filter values are always bind parameters (pyodbc '?' placeholders).
#   - Sort direction is constrained to the literal strings 'ASC' / 'DESC'.

import csv
import io
import logging
import math
from dataclasses import dataclass, field
from typing import Literal

import openpyxl
import pyodbc
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel, Field

from app.routes.browse_routes import TARGET_QUERY_TIMEOUT_SECONDS, _open_target, _require_connection_access
from app.utils.audit_helpers import log_export_audit
from app.utils.auth_dependency import verify_token
from app.utils.db_helpers import get_backend

router = APIRouter()
logger = logging.getLogger(__name__)

# Maximum rows that can be returned in a single page.
MAX_PAGE_SIZE = 200
DEFAULT_PAGE_SIZE = 50

# Maximum rows returned by a single export request.
MAX_EXPORT_ROWS = 10_000

# Supported filter operators and their SQL fragments.
# Values are always supplied as bind params; column names are bracket-quoted
# after allowlist validation.
OPERATOR_SQL: dict[str, str] = {
    "eq": "{col} = ?",
    "neq": "{col} <> ?",
    "contains": "{col} LIKE ?",
    "starts_with": "{col} LIKE ?",
    "ends_with": "{col} LIKE ?",
    "gt": "{col} > ?",
    "gte": "{col} >= ?",
    "lt": "{col} < ?",
    "lte": "{col} <= ?",
    "is_null": "{col} IS NULL",
    "is_not_null": "{col} IS NOT NULL",
}

# Operators that require no value argument.
NULL_OPERATORS = {"is_null", "is_not_null"}


# ---------------------------------------------------------------------------
# Request models
# ---------------------------------------------------------------------------


class FilterClause(BaseModel):
    column: str = Field(..., min_length=1, max_length=128)
    operator: Literal[
        "eq",
        "neq",
        "contains",
        "starts_with",
        "ends_with",
        "gt",
        "gte",
        "lt",
        "lte",
        "is_null",
        "is_not_null",
    ]
    value: str | None = None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _bracket(name: str) -> str:
    """Bracket-quote a SQL Server identifier, escaping any literal ] inside."""
    return "[" + name.replace("]", "]]") + "]"


def _validate_identifiers(
    cursor: pyodbc.Cursor,
    schema_name: str,
    table_name: str,
    column_names: list[str],
) -> tuple[str, str, list[str]]:
    """Validate schema/table/columns against INFORMATION_SCHEMA.

    Returns (canonical_schema, canonical_table, canonical_columns) — all
    names are taken directly from the DB, not from the caller's input.
    This ensures bracket-quoting uses the exact case the DB stores rather
    than the case supplied in the URL, and makes the security comment in
    the caller accurate: only DB-returned names reach the SQL template.

    Raises HTTPException 404 if the table is not found.
    Raises HTTPException 422 if any requested column is not in the table.

    The ``column_names`` argument lists columns to validate as present in the
    table (filter columns, sort column).  The full column list is always
    returned regardless of what was passed — callers that need all columns
    to build db_cols_lower use the return value directly.
    """
    # Fetch canonical schema and table name from INFORMATION_SCHEMA.TABLES.
    cursor.execute(
        "SELECT TABLE_SCHEMA, TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?",
        (schema_name, table_name),
    )
    table_row = cursor.fetchone()
    if not table_row:
        raise HTTPException(status_code=404, detail="Table not found")
    canonical_schema, canonical_table = table_row[0], table_row[1]

    # Fetch canonical column names in ordinal order.
    cursor.execute(
        "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS "
        "WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION",
        (schema_name, table_name),
    )
    db_columns = {row[0].lower(): row[0] for row in cursor.fetchall()}

    unknown = [c for c in column_names if c.lower() not in db_columns]
    if unknown:
        raise HTTPException(
            status_code=422,
            detail=f"Unknown column(s): {', '.join(unknown)}",
        )

    return canonical_schema, canonical_table, list(db_columns.values())


def _validate_column(db_columns_lower: dict[str, str], column: str) -> str:
    """Return the canonical column name or raise 422."""
    canonical = db_columns_lower.get(column.lower())
    if canonical is None:
        raise HTTPException(status_code=422, detail=f"Unknown column: {column!r}")
    return canonical


def _build_filter_value(operator: str, raw_value: str | None) -> str | None:
    """Translate a raw filter value into the appropriate LIKE pattern or plain value."""
    if raw_value is None:
        return None
    if operator == "contains":
        # Escape LIKE metacharacters in the user value, then wrap in %.
        escaped = raw_value.replace("[", "[[]").replace("%", "[%]").replace("_", "[_]")
        return f"%{escaped}%"
    if operator == "starts_with":
        escaped = raw_value.replace("[", "[[]").replace("%", "[%]").replace("_", "[_]")
        return f"{escaped}%"
    if operator == "ends_with":
        escaped = raw_value.replace("[", "[[]").replace("%", "[%]").replace("_", "[_]")
        return f"%{escaped}"
    return raw_value


def _parse_filters(filters: list[str] | None) -> list[FilterClause]:
    """Parse repeated ``col:op[:value]`` filter strings into FilterClause objects."""
    parsed: list[FilterClause] = []
    if not filters:
        return parsed
    for f in filters:
        parts = f.split(":", 2)
        if len(parts) < 2:
            raise HTTPException(
                status_code=422,
                detail=f"Invalid filter format: {f!r}. Expected column:operator[:value]",
            )
        col, op = parts[0], parts[1]
        val = parts[2] if len(parts) == 3 else None
        if op not in OPERATOR_SQL:
            raise HTTPException(status_code=422, detail=f"Unknown operator: {op!r}")
        if op not in NULL_OPERATORS and val is None:
            raise HTTPException(status_code=422, detail=f"Operator {op!r} requires a value")
        parsed.append(FilterClause(column=col, operator=op, value=val))
    return parsed


@dataclass
class _QueryParts:
    schema_q: str
    table_q: str
    where_sql: str
    bind_values: list
    order_sql: str
    all_db_cols: list[str]
    db_cols_lower: dict[str, str] = field(default_factory=dict)


def _build_query_parts(
    cursor: pyodbc.Cursor,
    schema_name: str,
    table_name: str,
    parsed_filters: list[FilterClause],
    sort_col: str | None,
    sort_dir: str,
) -> _QueryParts:
    """Validate identifiers and build WHERE / ORDER BY fragments.

    Shared by browse_table and export_table so the filter/sort logic has
    a single source of truth.
    """
    filter_cols = [f.column for f in parsed_filters]
    sort_cols = [sort_col] if sort_col else []
    all_check_cols = list(dict.fromkeys(filter_cols + sort_cols))  # deduplicated

    canonical_schema, canonical_table, all_db_cols = _validate_identifiers(
        cursor, schema_name, table_name, all_check_cols
    )
    db_cols_lower = {c.lower(): c for c in all_db_cols}

    schema_q = _bracket(canonical_schema)
    table_q = _bracket(canonical_table)

    # Build WHERE clause — column names bracket-quoted from allowlist.
    where_parts: list[str] = []
    bind_values: list = []

    for fc in parsed_filters:
        canonical_col = _validate_column(db_cols_lower, fc.column)
        col_q = _bracket(canonical_col)
        sql_fragment = OPERATOR_SQL[fc.operator].replace("{col}", col_q)
        where_parts.append(sql_fragment)
        if fc.operator not in NULL_OPERATORS:
            bind_values.append(_build_filter_value(fc.operator, fc.value))

    where_sql = ("WHERE " + " AND ".join(where_parts)) if where_parts else ""

    # Build ORDER BY — direction is constrained to ASC/DESC literal.
    if sort_col:
        canonical_sort = _validate_column(db_cols_lower, sort_col)
        direction = "DESC" if sort_dir.lower() == "desc" else "ASC"
        order_sql = f"ORDER BY {_bracket(canonical_sort)} {direction}"
    else:
        # Stable default: order by first column.
        order_sql = f"ORDER BY {_bracket(all_db_cols[0])} ASC"

    return _QueryParts(
        schema_q=schema_q,
        table_q=table_q,
        where_sql=where_sql,
        bind_values=bind_values,
        order_sql=order_sql,
        all_db_cols=all_db_cols,
        db_cols_lower=db_cols_lower,
    )


# ---------------------------------------------------------------------------
# GET /api/connections/{connection_id}/data/{schema_name}/{table_name}
# ---------------------------------------------------------------------------


@router.get("/{connection_id}/data/{schema_name}/{table_name}")
def browse_table(
    connection_id: str,
    schema_name: str,
    table_name: str,
    page: int = 1,
    page_size: int = DEFAULT_PAGE_SIZE,
    sort_col: str | None = None,
    sort_dir: Literal["asc", "desc"] = "asc",
    # filters encoded as repeated query params: filters=col:op:value
    # e.g. ?filters=Name:contains:Smith&filters=Age:gte:30
    filters: list[str] | None = None,
    user: dict = Depends(verify_token),
):
    """Return a paginated, sortable, filterable row view of a target table.

    Filter format: each filter is a colon-separated string ``column:operator:value``
    (or ``column:operator`` for null-check operators).

    All identifiers are validated against INFORMATION_SCHEMA before use.
    Filter values are always bind parameters.
    """
    if page < 1:
        raise HTTPException(status_code=422, detail="page must be >= 1")
    if page_size < 1:
        raise HTTPException(status_code=422, detail="page_size must be >= 1")
    page_size = min(page_size, MAX_PAGE_SIZE)

    creds = _require_connection_access(connection_id, user)
    parsed_filters = _parse_filters(filters)

    with _open_target(creds) as target:
        cursor = target.cursor()
        cursor.timeout = TARGET_QUERY_TIMEOUT_SECONDS

        qp = _build_query_parts(cursor, schema_name, table_name, parsed_filters, sort_col, sort_dir)

        # Total count (for pagination metadata).
        count_sql = f"SELECT COUNT(*) FROM {qp.schema_q}.{qp.table_q} {qp.where_sql}"
        cursor.execute(count_sql, list(qp.bind_values))
        total_count = cursor.fetchone()[0]

        # Paginated data using OFFSET/FETCH (SQL Server 2012+).
        offset = (page - 1) * page_size
        data_sql = (
            f"SELECT * FROM {qp.schema_q}.{qp.table_q} {qp.where_sql} {qp.order_sql} "
            f"OFFSET ? ROWS FETCH NEXT ? ROWS ONLY"
        )
        cursor.execute(data_sql, list(qp.bind_values) + [offset, page_size])

        col_names = [desc[0] for desc in cursor.description]
        raw_rows = cursor.fetchall()

    # Serialise rows — convert non-JSON-serialisable types to strings.
    def _coerce(v):
        if v is None:
            return None
        if isinstance(v, (int, float, bool)):
            return v
        # Dates, datetimes, decimals, bytes → string.
        return str(v)

    rows = [{col_names[i]: _coerce(row[i]) for i in range(len(col_names))} for row in raw_rows]

    total_pages = math.ceil(total_count / page_size) if total_count > 0 else 1

    return {
        "columns": col_names,
        "rows": rows,
        "total_count": total_count,
        "page": page,
        "page_size": page_size,
        "total_pages": total_pages,
    }


# ---------------------------------------------------------------------------
# GET /api/connections/{connection_id}/data/{schema_name}/{table_name}/export
# ---------------------------------------------------------------------------


def _csv_stream(creds: dict, col_names: list[str], data_sql: str, bind_values: list, table_name: str):
    """Generator that streams CSV rows directly from a pyodbc cursor.

    Opens its own connection so the connection lifetime extends through the full
    StreamingResponse iteration.  _open_target() returns a raw pyodbc.Connection
    (not a contextmanager wrapper), so calling it without `with` is correct here —
    .cursor() and .close() work directly on the connection object.

    The connection is closed in the finally block, which Python guarantees fires
    when the generator is closed (either by the consumer exhausting it or by
    FastAPI's response teardown).
    """
    target = _open_target(creds)
    try:
        cursor = target.cursor()
        cursor.timeout = TARGET_QUERY_TIMEOUT_SECONDS
        cursor.execute(data_sql, list(bind_values))

        buf = io.StringIO()
        writer = csv.writer(buf)

        # Header row.
        writer.writerow(col_names)
        yield buf.getvalue()
        buf.truncate(0)
        buf.seek(0)

        # Data rows in chunks.
        while True:
            chunk = cursor.fetchmany(500)
            if not chunk:
                break
            for row in chunk:
                writer.writerow(["" if v is None else str(v) for v in row])
            yield buf.getvalue()
            buf.truncate(0)
            buf.seek(0)
    finally:
        target.close()


@router.get("/{connection_id}/data/{schema_name}/{table_name}/export")
def export_table(
    connection_id: str,
    schema_name: str,
    table_name: str,
    export_format: Literal["csv", "xlsx"] = "csv",
    sort_col: str | None = None,
    sort_dir: Literal["asc", "desc"] = "asc",
    # Same filter format as browse_table.
    filters: list[str] | None = None,
    user: dict = Depends(verify_token),
):
    """Export a filtered, sorted table as CSV or XLSX.

    Returns at most MAX_EXPORT_ROWS rows.  Response headers:
      - X-Total-Count: total rows matching the filters (before the cap)
      - X-Export-Truncated: 'true' if the result was capped, 'false' otherwise

    Filter format is identical to browse_table (``column:operator[:value]``).
    All identifiers are validated against INFORMATION_SCHEMA before use.
    Export events are written to the audit log.
    """
    creds = _require_connection_access(connection_id, user)
    parsed_filters = _parse_filters(filters)

    # raw_rows is only populated for XLSX; initialise here so the name is
    # always bound even if an exception occurs inside the with block before
    # cursor.fetchall() is reached (avoids UnboundLocalError in the XLSX branch).
    raw_rows: list = []

    with _open_target(creds) as target:
        cursor = target.cursor()
        cursor.timeout = TARGET_QUERY_TIMEOUT_SECONDS

        qp = _build_query_parts(cursor, schema_name, table_name, parsed_filters, sort_col, sort_dir)

        # Total count so we can report truncation to the caller.
        count_sql = f"SELECT COUNT(*) FROM {qp.schema_q}.{qp.table_q} {qp.where_sql}"
        cursor.execute(count_sql, list(qp.bind_values))
        total_count = cursor.fetchone()[0]

        export_rows = min(total_count, MAX_EXPORT_ROWS)
        truncated = total_count > MAX_EXPORT_ROWS

        data_sql = (
            f"SELECT * FROM {qp.schema_q}.{qp.table_q} {qp.where_sql} {qp.order_sql} "
            f"OFFSET 0 ROWS FETCH NEXT {MAX_EXPORT_ROWS} ROWS ONLY"
        )

        # Column names come from _build_query_parts (validated against INFORMATION_SCHEMA);
        # no need to execute a separate query just to read cursor.description.
        col_names = qp.all_db_cols

        if export_format == "xlsx":
            cursor.execute(data_sql, list(qp.bind_values))
            raw_rows = cursor.fetchall()

    # Write export audit entry before dispatching the response.
    # log_export_audit swallows its own exceptions internally; no outer try/except needed.
    backend = get_backend()
    log_export_audit(
        backend=backend,
        user_id=user["user_id"],
        connection_id=connection_id,
        schema_name=schema_name,
        table_name=table_name,
        export_format=export_format,
        row_count=export_rows,
    )

    common_headers = {
        "X-Total-Count": str(total_count),
        "X-Export-Truncated": "true" if truncated else "false",
    }

    # Sanitise filename: keep alphanumeric, dot, dash, underscore; replace rest.
    safe_name = "".join(c if c.isalnum() or c in "._-" else "_" for c in table_name)

    if export_format == "csv":
        return StreamingResponse(
            _csv_stream(creds, col_names, data_sql, qp.bind_values, table_name),
            media_type="text/csv",
            headers={
                **common_headers,
                "Content-Disposition": f'attachment; filename="{safe_name}.csv"',
            },
        )

    # XLSX: build in memory (rows already fetched above, capped at 10k).
    wb = openpyxl.Workbook()
    ws = wb.active
    # Excel sheet names: max 31 chars, and must not contain \ / ? * [ ] :
    _ILLEGAL_SHEET_CHARS = str.maketrans({c: "_" for c in r"\/?*[:]"})
    ws.title = table_name.translate(_ILLEGAL_SHEET_CHARS)[:31]
    ws.append(col_names)
    for row in raw_rows:
        ws.append([None if v is None else str(v) for v in row])

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)

    return Response(
        content=buf.getvalue(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={
            **common_headers,
            "Content-Disposition": f'attachment; filename="{safe_name}.xlsx"',
        },
    )
