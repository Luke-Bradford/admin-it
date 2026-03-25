# app/routes/audit_routes.py

from fastapi import APIRouter, Depends, HTTPException

from app.utils.auth_dependency import verify_token
from app.utils.db_helpers import get_backend

router = APIRouter()

ADMIN_ROLES = {"Admin", "SystemAdmin"}


@router.get("")
def list_audit_records(user: dict = Depends(verify_token)):
    """Return the most recent audit log entries.

    Requires Admin role or above.
    Returns 501 if the active backend does not yet support audit records
    (i.e. MSSQL before ticket #77 is implemented).
    """
    if not ADMIN_ROLES.intersection(user.get("roles", [])):
        raise HTTPException(status_code=403, detail="Admin role required")

    backend = get_backend()
    try:
        return backend.get_audit_records()
    except NotImplementedError:
        raise HTTPException(
            status_code=501,
            detail="Audit log is not yet available for this backend type",
        )
