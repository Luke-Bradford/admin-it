# app/routes/audit_routes.py

from datetime import datetime
from typing import Literal, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.sql import text

from app.utils.auth_dependency import ADMIN_ROLES, verify_token
from app.utils.db_helpers import get_backend

router = APIRouter()


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
    """Return paginated, filtered audit log entries.

    Requires Admin role or above. Defaults to the last 24 hours when no date
    or record_id filter is supplied. When record_id is set, all history for
    that record is returned regardless of date.
    """
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


@router.get("/users")
def list_audit_users(user: dict = Depends(verify_token)):
    """Return active users for the audit log filter dropdown.

    Requires Admin role or above.
    """
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
        return [{"id": str(r._mapping["UserId"]), "username": r._mapping["Username"]} for r in rows]
    except NotImplementedError:
        raise HTTPException(
            status_code=501,
            detail="Audit log is not yet available for this backend type",
        )
