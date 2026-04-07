# app/routes/query_routes.py
#
# Phase 4 — Saved Query Library (#16).
#
# Power Users and Admins create parameterised SQL queries stored in the
# admin-it schema.  All authenticated users with access to the query's
# connection can run those queries via a generated form.
#
# Security model:
#   - All endpoints require a valid JWT (verify_token).
#   - Create/edit: PowerUser or Admin role + UserConnectionAccess to the
#     connection.  Admin+ bypass applies (no access row required).
#   - Delete: Admin or SystemAdmin only.
#   - Run/export: any authenticated user with UserConnectionAccess.
#   - SELECT enforcement on run/export: query text must start with SELECT
#     and must not contain a semicolon.  This is defence-in-depth only —
#     the real trust boundary is restricting write access to PowerUser+ roles.
# SELECT/semicolon check is defence-in-depth only.
# Trust boundary is enforced at create/edit (PowerUser+ role required).

import io
import json
import logging
import math
import re
from datetime import date, datetime, timezone
from typing import Literal

import openpyxl
import pyodbc
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import text

from app.routes.browse_routes import TARGET_QUERY_TIMEOUT_SECONDS, _open_target, _require_connection_access
from app.utils.audit_helpers import log_masked_access_audit, log_query_export_audit, log_query_run_audit
from app.utils.auth_dependency import ADMIN_ROLES, verify_token
from app.utils.constants import MAX_EXPORT_ROWS
from app.utils.db_helpers import get_backend
from app.utils.mask_helpers import load_masks_for_connection
from app.utils.sql_helpers import quote_ident as qi

router = APIRouter()
logger = logging.getLogger(__name__)

POWER_AND_ABOVE: set[str] = {"PowerUser", "Admin", "SystemAdmin"}
MAX_PAGE_SIZE = 200

# Regex for `:name` placeholder extraction and rewrite.
# Negative lookahead prevents partial matches (e.g. :user_id must not match inside :user_id_ext).
_PARAM_RE = re.compile(r":([a-zA-Z_][a-zA-Z0-9_]*)(?![a-zA-Z0-9_])")


# ---------------------------------------------------------------------------
# Request / response models
# ---------------------------------------------------------------------------


class QueryParameterIn(BaseModel):
    name: str = Field(..., pattern=r"^[a-zA-Z_][a-zA-Z0-9_]*$", max_length=100)
    label: str = Field(..., max_length=255)
    param_type: Literal["text", "number", "date", "boolean", "select"]
    is_required: bool = True
    default_value: str | None = Field(default=None, max_length=500)
    select_options: list[str] | None = None
    display_order: int = 0


class QueryIn(BaseModel):
    connection_id: str = Field(..., pattern=r"^[0-9a-fA-F\-]{36}$")
    name: str = Field(..., min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=1000)
    query_text: str = Field(..., min_length=1)
    parameters: list[QueryParameterIn] = []


class QueryPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=1000)
    query_text: str | None = Field(default=None, min_length=1)
    parameters: list[QueryParameterIn] | None = None
    # connection_id is intentionally not patchable


class RunRequest(BaseModel):
    parameters: dict[str, str] = {}
    page: int = Field(default=1, ge=1)
    page_size: int = Field(default=50, ge=1, le=MAX_PAGE_SIZE)


class ExportRequest(BaseModel):
    parameters: dict[str, str] = {}
    format: Literal["csv", "xlsx"] = "csv"


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _validate_params(params: list[QueryParameterIn]) -> None:
    """Apply shared parameter validation rules for POST and PATCH."""
    for p in params:
        if p.param_type == "select":
            if not p.select_options:
                raise HTTPException(
                    status_code=422,
                    detail=f"Parameter '{p.name}': select_options is required and must be non-empty for type 'select'",
                )
            for opt in p.select_options:
                if len(opt) > 500:
                    raise HTTPException(
                        status_code=422,
                        detail=f"Parameter '{p.name}': each select option must be <= 500 chars",
                    )
            if len(p.select_options) > 200:
                raise HTTPException(
                    status_code=422,
                    detail=f"Parameter '{p.name}': select_options must have <= 200 items",
                )
        elif p.select_options is not None:
            raise HTTPException(
                status_code=422,
                detail=f"Parameter '{p.name}': select_options must be null for type '{p.param_type}'",
            )


def _check_connection_access(connection_id: str, user: dict) -> None:
    """Verify the calling user has access to the given connection.

    Admin+ bypass: no access row required.
    Non-admin: must have a UserConnectionAccess row.
    Raises 403 on access denied (not 404, consistent with _require_connection_access).
    """
    if ADMIN_ROLES.intersection(user.get("roles", [])):
        # Verify the connection exists and is active.
        backend = get_backend()
        schema, db_type, engine = backend.schema, backend.db_type, backend.get_engine()
        with engine.connect() as conn:
            row = conn.execute(
                text(
                    f"SELECT 1 FROM {qi(schema, 'Connections', db_type)}"
                    ' WHERE "ConnectionId" = :cid AND "IsActive" = :active'
                ),
                {"cid": connection_id, "active": True},
            ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Connection not found")
        return

    backend = get_backend()
    schema, db_type, engine = backend.schema, backend.db_type, backend.get_engine()
    with engine.connect() as conn:
        row = conn.execute(
            text(f"""
                SELECT 1
                FROM {qi(schema, "Connections", db_type)} c
                JOIN {qi(schema, "UserConnectionAccess", db_type)} uca
                    ON uca."ConnectionId" = c."ConnectionId"
                WHERE c."ConnectionId" = :cid AND c."IsActive" = :active
                  AND uca."UserId" = :uid
            """),
            {"cid": connection_id, "active": True, "uid": user["user_id"]},
        ).fetchone()
    if not row:
        raise HTTPException(status_code=403, detail="Access denied to this connection")


def _fetch_query_row(saved_query_id: str, user: dict) -> dict:
    """Fetch a SavedQuery row and verify the calling user has connection access.

    Returns the query row as a dict.
    Raises 404 if not found or inactive.
    Raises 403 if the user has no access to the query's connection.
    """
    backend = get_backend()
    schema, db_type, engine = backend.schema, backend.db_type, backend.get_engine()

    with engine.connect() as conn:
        row = conn.execute(
            text(f"""
                SELECT q."SavedQueryId", q."ConnectionId", q."Name", q."Description",
                       q."QueryText", q."CreatedById",
                       q."CreatedDate", q."ModifiedById", q."ModifiedDate",
                       c."Name" AS "ConnectionName",
                       u."Username" AS "CreatedByUsername"
                FROM {qi(schema, "SavedQueries", db_type)} q
                JOIN {qi(schema, "Connections", db_type)} c ON c."ConnectionId" = q."ConnectionId"
                LEFT JOIN {qi(schema, "Users", db_type)} u ON u."UserId" = q."CreatedById"
                WHERE q."SavedQueryId" = :qid AND q."IsActive" = :active
            """),
            {"qid": saved_query_id, "active": True},
        ).fetchone()

    if not row:
        raise HTTPException(status_code=404, detail="Query not found")

    query = dict(
        zip(
            [
                "saved_query_id",
                "connection_id",
                "name",
                "description",
                "query_text",
                "created_by_id",
                "created_date",
                "modified_by_id",
                "modified_date",
                "connection_name",
                "created_by_username",
            ],
            row,
        )
    )

    # Access check — same as _require_connection_access logic but returns 403 not 404.
    is_admin = bool(ADMIN_ROLES.intersection(user.get("roles", [])))
    if not is_admin:
        with engine.connect() as conn:
            access = conn.execute(
                text(f"""
                    SELECT 1 FROM {qi(schema, "UserConnectionAccess", db_type)}
                    WHERE "ConnectionId" = :cid AND "UserId" = :uid
                """),
                {"cid": query["connection_id"], "uid": user["user_id"]},
            ).fetchone()
        if not access:
            raise HTTPException(status_code=403, detail="Access denied to this connection")

    return query


def _fetch_parameters(saved_query_id: str) -> list[dict]:
    """Fetch QueryParameters for a saved query, ordered by DisplayOrder, ParameterId."""
    backend = get_backend()
    schema, db_type, engine = backend.schema, backend.db_type, backend.get_engine()

    with engine.connect() as conn:
        rows = conn.execute(
            text(f"""
                SELECT "ParameterId", "Name", "Label", "ParamType",
                       "IsRequired", "DefaultValue", "SelectOptions", "DisplayOrder"
                FROM {qi(schema, "QueryParameters", db_type)}
                WHERE "SavedQueryId" = :qid
                ORDER BY "DisplayOrder" ASC, "ParameterId" ASC
            """),
            {"qid": saved_query_id},
        ).fetchall()

    result = []
    for r in rows:
        param = {
            "parameter_id": str(r[0]),
            "name": r[1],
            "label": r[2],
            "param_type": r[3],
            "is_required": bool(r[4]),
            "default_value": r[5],
            "select_options": json.loads(r[6]) if r[6] else None,
            "display_order": r[7],
        }
        result.append(param)
    return result


def _build_query_response(query: dict, params: list[dict], include_query_text: bool) -> dict:
    created = query["created_date"]
    modified = query["modified_date"]
    resp = {
        "id": str(query["saved_query_id"]),
        "connection_id": str(query["connection_id"]),
        "connection_name": query["connection_name"],
        "name": query["name"],
        "description": query["description"],
        "created_by_username": query["created_by_username"],
        "created_date": created.isoformat() if hasattr(created, "isoformat") else str(created),
        "modified_date": modified.isoformat() if hasattr(modified, "isoformat") else str(modified),
        "parameters": params,
    }
    if include_query_text:
        resp["query_text"] = query["query_text"]
    return resp


def _coerce_param(name: str, value: str, param_type: str, select_options: list[str] | None):
    """Coerce a raw string value to its declared Python type.

    Raises 422 on type mismatch.
    """
    if param_type == "text":
        return value.strip()
    if param_type == "number":
        try:
            return float(value)
        except (ValueError, TypeError):
            raise HTTPException(status_code=422, detail=f"Parameter '{name}': expected a number")
    if param_type == "date":
        try:
            return date.fromisoformat(value)
        except (ValueError, TypeError):
            raise HTTPException(status_code=422, detail=f"Parameter '{name}': expected a date (YYYY-MM-DD)")
    if param_type == "boolean":
        v = value.strip().lower()
        if v in ("true", "1", "yes"):
            return True
        if v in ("false", "0", "no"):
            return False
        raise HTTPException(status_code=422, detail=f"Parameter '{name}': expected true/false")
    if param_type == "select":
        if select_options is None:
            raise HTTPException(status_code=500, detail=f"Parameter '{name}': select_options missing in DB")
        if value not in select_options:
            raise HTTPException(status_code=422, detail=f"Parameter '{name}': value must be one of {select_options}")
        return value
    raise HTTPException(status_code=500, detail=f"Parameter '{name}': unknown type '{param_type}'")


def _validate_select_text(query_text: str) -> None:
    """Enforce SELECT-only, no-semicolon constraint.

    Raises 422 if the query text fails validation.
    """
    stripped = query_text.strip()
    if not stripped.upper().startswith("SELECT"):
        raise HTTPException(
            status_code=422,
            detail="Query must start with SELECT. CTE/WITH queries are not supported.",
        )
    if ";" in stripped:
        raise HTTPException(
            status_code=422,
            detail="Query text must not contain a semicolon.",
        )


def _rewrite_and_bind(query_text: str, param_defs: list[dict], supplied: dict[str, str]) -> tuple[str, list]:
    """Rewrite :name placeholders to ? and build a positional value list.

    - Replaces :name tokens left-to-right using _PARAM_RE.
    - Builds the value list in the same text order.
    - Validates required params are present; coerces types; ignores unknown keys.
    - Returns (positional_sql, values_list).
    """
    # Index param defs by name for fast lookup.
    defs_by_name = {p["name"]: p for p in param_defs}

    # Check required params are supplied.
    for p in param_defs:
        if p["is_required"] and p["name"] not in supplied and p["default_value"] is None:
            raise HTTPException(status_code=422, detail=f"Required parameter '{p['name']}' is missing")

    # Rewrite and collect values in text order.
    tokens_in_order = _PARAM_RE.findall(query_text)
    positional_sql = _PARAM_RE.sub("?", query_text)

    values = []
    for token in tokens_in_order:
        if token not in defs_by_name:
            # Placeholder in SQL has no matching parameter definition — 422.
            raise HTTPException(
                status_code=422,
                detail=f"Query references placeholder :{token} which has no parameter definition",
            )
        p = defs_by_name[token]
        raw = supplied.get(token, p["default_value"])
        if raw is None:
            if p["is_required"]:
                raise HTTPException(status_code=422, detail=f"Required parameter '{token}' is missing")
            raw = None
        select_options = p["select_options"]  # already a list from _fetch_parameters
        coerced = (
            _coerce_param(token, raw if raw is not None else "", p["param_type"], select_options)
            if raw is not None
            else None
        )
        values.append(coerced)

    return positional_sql, values


def _execute_paginated(
    cursor: pyodbc.Cursor, positional_sql: str, values: list, page: int, page_size: int, db_type: str
):
    """Execute count + page queries using subquery wrapping. Returns (col_names, rows, total_count)."""
    count_sql = f"SELECT COUNT(*) FROM ({positional_sql}) AS __sq_wrap__"
    cursor.execute(count_sql, values)
    total_count = cursor.fetchone()[0]

    offset = (page - 1) * page_size
    if db_type == "postgres":
        page_sql = f"SELECT * FROM ({positional_sql}) AS __sq_wrap__ LIMIT ? OFFSET ?"
    else:
        page_sql = (
            f"SELECT * FROM ({positional_sql}) AS __sq_wrap__ "
            f"ORDER BY (SELECT NULL) OFFSET ? ROWS FETCH NEXT ? ROWS ONLY"
        )

    cursor.execute(page_sql, values + [page_size, offset] if db_type == "postgres" else values + [offset, page_size])
    col_names = [desc[0] for desc in cursor.description]
    raw_rows = cursor.fetchall()
    rows = [{col_names[i]: _coerce_val(r[i]) for i in range(len(col_names))} for r in raw_rows]
    return col_names, rows, total_count


def _coerce_val(v):
    """Coerce pyodbc result values to JSON-serialisable types."""
    if isinstance(v, (datetime, date)):
        return v.isoformat()
    return v


def _apply_masking(
    rows: list[dict], col_names: list[str], masked_cols_lower: set[str], is_admin: bool
) -> tuple[list[dict], list[str]]:
    """Apply column masking. Returns (masked_rows, original_case_masked_col_names)."""
    masked_col_names = [c for c in col_names if c.lower() in masked_cols_lower]
    if not masked_col_names:
        return rows, []
    if is_admin:
        return rows, masked_col_names
    masked_rows = [
        {col: ("****" if col.lower() in masked_cols_lower else val) for col, val in row.items()} for row in rows
    ]
    return masked_rows, masked_col_names


def _safe_filename(name: str) -> str:
    return re.sub(r"[^a-zA-Z0-9._-]", "_", name)


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.post("", status_code=201)
def create_query(body: QueryIn, user: dict = Depends(verify_token)):
    if not POWER_AND_ABOVE.intersection(user.get("roles", [])):
        raise HTTPException(status_code=403, detail="PowerUser or Admin role required")

    _check_connection_access(body.connection_id, user)
    _validate_params(body.parameters)

    backend = get_backend()
    schema, db_type, engine = backend.schema, backend.db_type, backend.get_engine()
    q_table = qi(schema, "SavedQueries", db_type)
    p_table = qi(schema, "QueryParameters", db_type)
    now = datetime.now(timezone.utc)

    with engine.begin() as conn:
        # Check for duplicate name on this connection (active AND inactive — the DB
        # UNIQUE constraint covers both states, so we match it here to return a 409
        # rather than letting an integrity error bubble as a 500).
        dup = conn.execute(
            text(f'SELECT 1 FROM {q_table} WHERE "ConnectionId" = :cid AND "Name" = :name'),
            {"cid": body.connection_id, "name": body.name},
        ).fetchone()
        if dup:
            raise HTTPException(status_code=409, detail="A query with this name already exists for this connection")

        # Use OUTPUT / RETURNING to fetch the generated PK atomically.
        if db_type == "postgres":
            new_id_row = conn.execute(
                text(f"""
                    INSERT INTO {q_table}
                        ("ConnectionId", "Name", "Description", "QueryText",
                         "IsActive", "CreatedById", "CreatedDate", "ModifiedById", "ModifiedDate")
                    VALUES (:cid, :name, :desc, :qt, :active, :uid, :now, :uid, :now)
                    RETURNING "SavedQueryId"
                """),
                {
                    "cid": body.connection_id,
                    "name": body.name,
                    "desc": body.description,
                    "qt": body.query_text,
                    "active": True,
                    "uid": user["user_id"],
                    "now": now,
                },
            ).fetchone()
        else:
            new_id_row = conn.execute(
                text(f"""
                    INSERT INTO {q_table}
                        ("ConnectionId", "Name", "Description", "QueryText",
                         "IsActive", "CreatedById", "CreatedDate", "ModifiedById", "ModifiedDate")
                    OUTPUT INSERTED."SavedQueryId"
                    VALUES (:cid, :name, :desc, :qt, :active, :uid, :now, :uid, :now)
                """),
                {
                    "cid": body.connection_id,
                    "name": body.name,
                    "desc": body.description,
                    "qt": body.query_text,
                    "active": True,
                    "uid": user["user_id"],
                    "now": now,
                },
            ).fetchone()
        new_id = str(new_id_row[0])

        for p in body.parameters:
            conn.execute(
                text(f"""
                    INSERT INTO {p_table}
                        ("SavedQueryId", "Name", "Label", "ParamType",
                         "IsRequired", "DefaultValue", "SelectOptions", "DisplayOrder")
                    VALUES (:qid, :name, :label, :ptype, :req, :def, :opts, :order)
                """),
                {
                    "qid": new_id,
                    "name": p.name,
                    "label": p.label,
                    "ptype": p.param_type,
                    "req": p.is_required,
                    "def": p.default_value,
                    "opts": json.dumps(p.select_options) if p.select_options else None,
                    "order": p.display_order,
                },
            )

    query = _fetch_query_row(new_id, user)
    params = _fetch_parameters(new_id)
    return _build_query_response(query, params, include_query_text=True)


@router.get("")
def list_queries(
    connection_id: str | None = Query(default=None, pattern=r"^[0-9a-fA-F\-]{36}$"),
    user: dict = Depends(verify_token),
):
    backend = get_backend()
    schema, db_type, engine = backend.schema, backend.db_type, backend.get_engine()
    q_table = qi(schema, "SavedQueries", db_type)
    c_table = qi(schema, "Connections", db_type)
    u_table = qi(schema, "Users", db_type)
    uca_table = qi(schema, "UserConnectionAccess", db_type)

    is_admin = bool(ADMIN_ROLES.intersection(user.get("roles", [])))
    is_power_plus = bool(POWER_AND_ABOVE.intersection(user.get("roles", [])))

    if is_admin:
        where_clauses = ['q."IsActive" = :active']
        bind: dict = {"active": True}
    else:
        where_clauses = [
            'q."IsActive" = :active',
            'uca."UserId" = :uid',
        ]
        bind = {"active": True, "uid": user["user_id"]}

    if connection_id:
        where_clauses.append('q."ConnectionId" = :cid')
        bind["cid"] = connection_id

    where_sql = "WHERE " + " AND ".join(where_clauses)

    if is_admin:
        join_sql = ""  # admin sees all active queries; no access-filter join needed
    else:
        join_sql = f'JOIN {uca_table} uca ON uca."ConnectionId" = q."ConnectionId" AND uca."UserId" = :uid'

    with engine.connect() as conn:
        rows = conn.execute(
            text(f"""
                SELECT q."SavedQueryId", q."ConnectionId", c."Name" AS "ConnectionName",
                       q."Name", q."Description", q."QueryText",
                       q."CreatedDate", q."ModifiedDate",
                       u."Username" AS "CreatedByUsername"
                FROM {q_table} q
                JOIN {c_table} c ON c."ConnectionId" = q."ConnectionId"
                LEFT JOIN {u_table} u ON u."UserId" = q."CreatedById"
                {join_sql}
                {where_sql}
                ORDER BY q."Name" ASC
            """),
            bind,
        ).fetchall()

        # Batch-fetch all parameters for the returned query IDs — avoids N+1 queries.
        if rows:
            p_table = qi(schema, "QueryParameters", db_type)
            query_ids = [str(r[0]) for r in rows]
            # SQLAlchemy text() doesn't support list expansion natively; build a safe
            # parameterised IN clause using sequentially numbered bind names.
            in_params = {f"qid{i}": qid for i, qid in enumerate(query_ids)}
            in_clause = ", ".join(f":qid{i}" for i in range(len(query_ids)))
            param_rows = conn.execute(
                text(f"""
                    SELECT "SavedQueryId", "ParameterId", "Name", "Label", "ParamType",
                           "IsRequired", "DefaultValue", "SelectOptions", "DisplayOrder"
                    FROM {p_table}
                    WHERE "SavedQueryId" IN ({in_clause})
                    ORDER BY "SavedQueryId", "DisplayOrder" ASC, "ParameterId" ASC
                """),
                in_params,
            ).fetchall()
        else:
            param_rows = []

    # Index parameters by SavedQueryId.
    params_by_qid: dict[str, list[dict]] = {}
    for pr in param_rows:
        qid = str(pr[0])
        if qid not in params_by_qid:
            params_by_qid[qid] = []
        params_by_qid[qid].append(
            {
                "parameter_id": str(pr[1]),
                "name": pr[2],
                "label": pr[3],
                "param_type": pr[4],
                "is_required": bool(pr[5]),
                "default_value": pr[6],
                "select_options": json.loads(pr[7]) if pr[7] else None,
                "display_order": pr[8],
            }
        )

    result = []
    for r in rows:
        qid = str(r[0])
        item = {
            "id": qid,
            "connection_id": str(r[1]),
            "connection_name": r[2],
            "name": r[3],
            "description": r[4],
            "created_date": r[6].isoformat() if hasattr(r[6], "isoformat") else str(r[6]),
            "modified_date": r[7].isoformat() if hasattr(r[7], "isoformat") else str(r[7]),
            "created_by_username": r[8],
            "parameters": params_by_qid.get(qid, []),
        }
        if is_power_plus:
            item["query_text"] = r[5]
        result.append(item)

    return result


@router.get("/{saved_query_id}")
def get_query(saved_query_id: str, user: dict = Depends(verify_token)):
    query = _fetch_query_row(saved_query_id, user)
    params = _fetch_parameters(saved_query_id)
    is_power_plus = bool(POWER_AND_ABOVE.intersection(user.get("roles", [])))
    return _build_query_response(query, params, include_query_text=is_power_plus)


@router.patch("/{saved_query_id}")
def update_query(saved_query_id: str, body: QueryPatch, user: dict = Depends(verify_token)):
    if not POWER_AND_ABOVE.intersection(user.get("roles", [])):
        raise HTTPException(status_code=403, detail="PowerUser or Admin role required")

    if not body.model_fields_set:
        raise HTTPException(status_code=400, detail="No fields to update")

    # Pre-flight: verify query exists and caller has access.
    existing = _fetch_query_row(saved_query_id, user)

    if body.parameters is not None:
        _validate_params(body.parameters)

    backend = get_backend()
    schema, db_type, engine = backend.schema, backend.db_type, backend.get_engine()
    q_table = qi(schema, "SavedQueries", db_type)
    p_table = qi(schema, "QueryParameters", db_type)
    now = datetime.now(timezone.utc)

    # Name-uniqueness check (active + inactive) before the UPDATE.
    # Must exclude the current query's own row so a no-op name update doesn't self-collide.
    if "name" in body.model_fields_set and body.name is not None and body.name != existing["name"]:
        with engine.connect() as conn:
            dup = conn.execute(
                text(
                    f'SELECT 1 FROM {q_table} WHERE "ConnectionId" = :cid AND "Name" = :name AND "SavedQueryId" != :qid'
                ),
                {"cid": existing["connection_id"], "name": body.name, "qid": saved_query_id},
            ).fetchone()
        if dup:
            raise HTTPException(status_code=409, detail="A query with this name already exists for this connection")

    set_clauses = ['"ModifiedById" = :uid', '"ModifiedDate" = :now']
    bind: dict = {"uid": user["user_id"], "now": now, "qid": saved_query_id}

    if "name" in body.model_fields_set and body.name is not None:
        set_clauses.append('"Name" = :name')
        bind["name"] = body.name
    if "description" in body.model_fields_set:
        set_clauses.append('"Description" = :desc')
        bind["desc"] = body.description  # None clears the field
    if "query_text" in body.model_fields_set and body.query_text is not None:
        set_clauses.append('"QueryText" = :qt')
        bind["qt"] = body.query_text

    with engine.begin() as conn:
        conn.execute(
            text(f'UPDATE {q_table} SET {", ".join(set_clauses)} WHERE "SavedQueryId" = :qid'),
            bind,
        )
        if body.parameters is not None:
            conn.execute(
                text(f'DELETE FROM {p_table} WHERE "SavedQueryId" = :qid'),
                {"qid": saved_query_id},
            )
            for p in body.parameters:
                conn.execute(
                    text(f"""
                        INSERT INTO {p_table}
                            ("SavedQueryId", "Name", "Label", "ParamType",
                             "IsRequired", "DefaultValue", "SelectOptions", "DisplayOrder")
                        VALUES (:qid, :name, :label, :ptype, :req, :def, :opts, :order)
                    """),
                    {
                        "qid": saved_query_id,
                        "name": p.name,
                        "label": p.label,
                        "ptype": p.param_type,
                        "req": p.is_required,
                        "def": p.default_value,
                        "opts": json.dumps(p.select_options) if p.select_options else None,
                        "order": p.display_order,
                    },
                )

    updated = _fetch_query_row(saved_query_id, user)
    params = _fetch_parameters(saved_query_id)
    is_power_plus = bool(POWER_AND_ABOVE.intersection(user.get("roles", [])))
    return _build_query_response(updated, params, include_query_text=is_power_plus)


@router.delete("/{saved_query_id}", status_code=204)
def delete_query(saved_query_id: str, user: dict = Depends(verify_token)):
    if not ADMIN_ROLES.intersection(user.get("roles", [])):
        raise HTTPException(status_code=403, detail="Admin or SystemAdmin role required")

    backend = get_backend()
    schema, db_type, engine = backend.schema, backend.db_type, backend.get_engine()
    q_table = qi(schema, "SavedQueries", db_type)
    now = datetime.now(timezone.utc)

    with engine.begin() as conn:
        result = conn.execute(
            text(f"""
                UPDATE {q_table}
                SET "IsActive" = :inactive, "ModifiedById" = :uid, "ModifiedDate" = :now
                WHERE "SavedQueryId" = :qid AND "IsActive" = :active
            """),
            {"inactive": False, "uid": user["user_id"], "now": now, "qid": saved_query_id, "active": True},
        )
        if result.rowcount == 0:
            raise HTTPException(status_code=404, detail="Query not found or already inactive")


@router.post("/{saved_query_id}/run")
def run_query(saved_query_id: str, body: RunRequest, user: dict = Depends(verify_token)):
    query = _fetch_query_row(saved_query_id, user)
    param_defs = _fetch_parameters(saved_query_id)

    _validate_select_text(query["query_text"])
    positional_sql, values = _rewrite_and_bind(query["query_text"], param_defs, body.parameters)

    backend = get_backend()
    is_admin = bool(ADMIN_ROLES.intersection(user.get("roles", [])))

    # Load masks — re-raises on failure (never fails open).
    masked_cols_lower = load_masks_for_connection(backend, str(query["connection_id"]))

    creds = _require_connection_access(str(query["connection_id"]), user)

    with _open_target(creds) as target:
        cursor = target.cursor()
        cursor.timeout = TARGET_QUERY_TIMEOUT_SECONDS
        col_names, rows, total_count = _execute_paginated(
            cursor, positional_sql, values, body.page, body.page_size, backend.db_type
        )

    rows, masked_col_names = _apply_masking(rows, col_names, masked_cols_lower, is_admin)

    # Only admins see real values in masked columns; audit their access.
    # Non-admins receive '****' substitution — no audit needed for that path.
    if masked_col_names and is_admin:
        log_masked_access_audit(
            backend=backend,
            user_id=user["user_id"],
            connection_id=str(query["connection_id"]),
            schema_name="SavedQuery",
            table_name=query["name"],
            masked_columns=sorted(c.lower() for c in masked_col_names),
        )

    if body.page == 1:
        log_query_run_audit(backend=backend, user_id=user["user_id"], saved_query_id=saved_query_id)

    total_pages = math.ceil(total_count / body.page_size) if total_count > 0 else 1

    return {
        "columns": col_names,
        "rows": rows,
        "masked_columns": masked_col_names,
        "total_count": total_count,
        "page": body.page,
        "page_size": body.page_size,
        "total_pages": total_pages,
    }


@router.post("/{saved_query_id}/export")
def export_query(saved_query_id: str, body: ExportRequest, user: dict = Depends(verify_token)):
    query = _fetch_query_row(saved_query_id, user)
    param_defs = _fetch_parameters(saved_query_id)

    _validate_select_text(query["query_text"])
    positional_sql, values = _rewrite_and_bind(query["query_text"], param_defs, body.parameters)

    backend = get_backend()
    is_admin = bool(ADMIN_ROLES.intersection(user.get("roles", [])))

    # Load masks — re-raises on failure (never fails open).
    masked_cols_lower = load_masks_for_connection(backend, str(query["connection_id"]))

    creds = _require_connection_access(str(query["connection_id"]), user)

    with _open_target(creds) as target:
        cursor = target.cursor()
        cursor.timeout = TARGET_QUERY_TIMEOUT_SECONDS

        count_sql = f"SELECT COUNT(*) FROM ({positional_sql}) AS __sq_wrap__"
        cursor.execute(count_sql, values)
        total_count = cursor.fetchone()[0]
        export_rows = min(total_count, MAX_EXPORT_ROWS)
        truncated = total_count > MAX_EXPORT_ROWS

        if backend.db_type == "postgres":
            data_sql = f"SELECT * FROM ({positional_sql}) AS __sq_wrap__ LIMIT ?"
            cursor.execute(data_sql, values + [MAX_EXPORT_ROWS])
        else:
            data_sql = (
                f"SELECT * FROM ({positional_sql}) AS __sq_wrap__ "
                f"ORDER BY (SELECT NULL) OFFSET 0 ROWS FETCH NEXT ? ROWS ONLY"
            )
            cursor.execute(data_sql, values + [MAX_EXPORT_ROWS])

        col_names = [desc[0] for desc in cursor.description]

        # For non-admins, exclude masked columns from the export entirely.
        if masked_cols_lower and not is_admin:
            export_col_names = [c for c in col_names if c.lower() not in masked_cols_lower]
        else:
            export_col_names = col_names

        col_idx = {name: i for i, name in enumerate(col_names)}

        if body.format == "xlsx":
            raw_rows = cursor.fetchall()
        else:
            raw_rows = None

    if masked_cols_lower and is_admin:
        masked_col_names = [c for c in col_names if c.lower() in masked_cols_lower]
        log_masked_access_audit(
            backend=backend,
            user_id=user["user_id"],
            connection_id=str(query["connection_id"]),
            schema_name="SavedQuery",
            table_name=query["name"],
            masked_columns=sorted(c.lower() for c in masked_col_names),
        )

    log_query_export_audit(
        backend=backend,
        user_id=user["user_id"],
        saved_query_id=saved_query_id,
        export_format=body.format,
        row_count=export_rows,
    )

    safe_name = _safe_filename(query["name"])
    headers = {"X-Total-Count": str(export_rows)}
    if truncated:
        headers["X-Export-Truncated"] = "true"

    if body.format == "csv":

        def _gen_csv():
            yield ",".join(export_col_names) + "\n"
            with _open_target(creds) as target2:
                cursor2 = target2.cursor()
                cursor2.timeout = TARGET_QUERY_TIMEOUT_SECONDS
                if backend.db_type == "postgres":
                    cursor2.execute(
                        f"SELECT * FROM ({positional_sql}) AS __sq_wrap__ LIMIT ?",
                        values + [MAX_EXPORT_ROWS],
                    )
                else:
                    cursor2.execute(
                        f"SELECT * FROM ({positional_sql}) AS __sq_wrap__"
                        " ORDER BY (SELECT NULL) OFFSET 0 ROWS FETCH NEXT ? ROWS ONLY",
                        values + [MAX_EXPORT_ROWS],
                    )
                for row in cursor2:
                    yield (
                        ",".join(
                            '"' + str(_coerce_val(row[col_idx[c]])).replace('"', '""') + '"' for c in export_col_names
                        )
                        + "\n"
                    )

        return StreamingResponse(
            _gen_csv(),
            media_type="text/csv",
            headers={**headers, "Content-Disposition": f'attachment; filename="{safe_name}.csv"'},
        )

    # XLSX
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.append(export_col_names)
    for row in raw_rows:
        ws.append([_coerce_val(row[col_idx[c]]) for c in export_col_names])

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return Response(
        content=buf.read(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={**headers, "Content-Disposition": f'attachment; filename="{safe_name}.xlsx"'},
    )
