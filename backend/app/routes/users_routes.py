# app/routes/users_routes.py

import logging
import uuid
from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import text

from app.utils.auth_dependency import verify_token
from app.utils.db_helpers import get_config_and_engine
from app.utils.password import hash_password

router = APIRouter()
logger = logging.getLogger(__name__)

ADMIN_ROLES = {"Admin", "SystemAdmin"}

# Role precedence used to enforce "cannot grant a role higher than your own".
# Higher number = higher privilege. Any role not listed is treated as 0.
ROLE_PRECEDENCE = {
    "EndUser": 1,
    "Admin": 2,
    "SystemAdmin": 3,
}


# ---------------------------------------------------------------------------
# Request models
# ---------------------------------------------------------------------------


RoleName = Literal["EndUser", "Admin", "SystemAdmin"]

# Columns allowed in the dynamic PATCH SET clause — prevents any possibility
# of an unexpected key reaching the raw SQL template.
PATCHABLE_COLUMNS = {"Username", "Email", "IsActive"}


class UserCreate(BaseModel):
    username: str = Field(..., min_length=1, max_length=100)
    email: str = Field(..., min_length=1, max_length=255)
    password: str = Field(..., min_length=12)
    role: RoleName


class UserPatch(BaseModel):
    username: str | None = Field(None, min_length=1, max_length=100)
    email: str | None = Field(None, min_length=1, max_length=255)
    role: RoleName | None = None
    is_active: bool | None = None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _require_admin(user: dict) -> None:
    if not ADMIN_ROLES.intersection(user.get("roles", [])):
        raise HTTPException(status_code=403, detail="Admin role required")


def _require_system_admin(user: dict) -> None:
    if "SystemAdmin" not in user.get("roles", []):
        raise HTTPException(status_code=403, detail="SystemAdmin role required")


def _caller_max_precedence(user: dict) -> int:
    return max((ROLE_PRECEDENCE.get(r, 0) for r in user.get("roles", [])), default=0)


def _parse_user_id(raw: str) -> str:
    try:
        return str(uuid.UUID(raw))
    except ValueError:
        raise HTTPException(status_code=422, detail="Invalid user ID format")


def _fetch_role_id(conn, schema: str, role_name: str) -> str:
    row = conn.execute(
        text(f"SELECT RoleId FROM [{schema}].[Roles] WHERE RoleName = :name"),
        {"name": role_name},
    ).fetchone()
    if not row:
        raise HTTPException(status_code=422, detail=f"Role '{role_name}' does not exist")
    return str(row[0])


def _count_active_system_admins(conn, schema: str) -> int:
    return conn.execute(
        text(f"""
            SELECT COUNT(*)
            FROM [{schema}].[Users] u
            JOIN [{schema}].[UserRoles] ur ON ur.UserId = u.UserId
            JOIN [{schema}].[Roles] r ON r.RoleId = ur.RoleId
            WHERE r.RoleName = 'SystemAdmin' AND u.IsActive = 1
        """)
    ).scalar()


# ---------------------------------------------------------------------------
# GET /api/users
# ---------------------------------------------------------------------------


@router.get("")
def list_users(user: dict = Depends(verify_token)):
    _require_admin(user)
    config, engine = get_config_and_engine()
    schema = config.schema

    with engine.connect() as conn:
        rows = conn.execute(
            text(f"""
                SELECT
                    u.UserId,
                    u.Username,
                    u.Email,
                    u.IsActive,
                    u.CreatedDate,
                    u.ModifiedDate,
                    r.RoleName
                FROM [{schema}].[Users] u
                LEFT JOIN [{schema}].[UserRoles] ur ON ur.UserId = u.UserId
                LEFT JOIN [{schema}].[Roles] r ON r.RoleId = ur.RoleId
                ORDER BY u.Username
            """)
        ).fetchall()

    # Collapse multiple role rows per user into a list
    users: dict[str, dict] = {}
    for row in rows:
        uid = str(row[0])
        if uid not in users:
            users[uid] = {
                "id": uid,
                "username": row[1],
                "email": row[2],
                "is_active": bool(row[3]),
                "created_date": row[4].isoformat() if row[4] else None,
                "modified_date": row[5].isoformat() if row[5] else None,
                "roles": [],
            }
        if row[6]:
            users[uid]["roles"].append(row[6])

    return list(users.values())


# ---------------------------------------------------------------------------
# POST /api/users
# ---------------------------------------------------------------------------


@router.post("", status_code=201)
def create_user(body: UserCreate, user: dict = Depends(verify_token)):
    _require_admin(user)

    # Caller cannot grant a role with higher precedence than their own.
    target_precedence = ROLE_PRECEDENCE.get(body.role, 0)
    if target_precedence > _caller_max_precedence(user):
        raise HTTPException(
            status_code=403,
            detail=f"You cannot assign the '{body.role}' role — it exceeds your own privilege level",
        )

    config, engine = get_config_and_engine()
    schema = config.schema
    now = datetime.now(timezone.utc)

    with engine.begin() as conn:
        # Duplicate username / email check
        conflict = conn.execute(
            text(f"""
                SELECT 1 FROM [{schema}].[Users]
                WHERE Username = :username OR Email = :email
            """),
            {"username": body.username, "email": body.email},
        ).fetchone()
        if conflict:
            raise HTTPException(status_code=409, detail="Username or email already in use")

        role_id = _fetch_role_id(conn, schema, body.role)

        user_id = str(uuid.uuid4())
        hashed = hash_password(body.password)

        conn.execute(
            text(f"""
                INSERT INTO [{schema}].[Users]
                    (UserId, Username, Email, PasswordHash, IsActive,
                     CreatedById, CreatedDate, ModifiedById, ModifiedDate)
                VALUES
                    (:uid, :username, :email, :phash, 1,
                     :cid, :now, :cid, :now)
            """),
            {
                "uid": user_id,
                "username": body.username,
                "email": body.email,
                "phash": hashed,
                "cid": user["user_id"],
                "now": now,
            },
        )

        conn.execute(
            text(f"""
                INSERT INTO [{schema}].[UserSecrets]
                    (UserSecretId, UserId, Salt,
                     CreatedById, CreatedDate, ModifiedById, ModifiedDate)
                VALUES
                    (:sid, :uid, '',
                     :cid, :now, :cid, :now)
            """),
            {"sid": str(uuid.uuid4()), "uid": user_id, "cid": user["user_id"], "now": now},
        )

        conn.execute(
            text(f"""
                INSERT INTO [{schema}].[UserRoles]
                    (UserId, RoleId, AssignedDate,
                     CreatedById, CreatedDate, ModifiedById, ModifiedDate)
                VALUES
                    (:uid, :rid, :now,
                     :cid, :now, :cid, :now)
            """),
            {"uid": user_id, "rid": role_id, "cid": user["user_id"], "now": now},
        )

    return {"id": user_id, "username": body.username, "email": body.email, "role": body.role}


# ---------------------------------------------------------------------------
# PATCH /api/users/{user_id}
# ---------------------------------------------------------------------------


@router.patch("/{user_id}")
def update_user(user_id: str, body: UserPatch, user: dict = Depends(verify_token)):
    _require_admin(user)
    uid = _parse_user_id(user_id)

    if body.role is not None:
        target_precedence = ROLE_PRECEDENCE.get(body.role, 0)
        if target_precedence > _caller_max_precedence(user):
            raise HTTPException(
                status_code=403,
                detail=f"You cannot assign the '{body.role}' role — it exceeds your own privilege level",
            )

    config, engine = get_config_and_engine()
    schema = config.schema
    now = datetime.now(timezone.utc)

    with engine.begin() as conn:
        existing = conn.execute(
            text(f"""
                SELECT u.UserId, u.Username, u.Email, u.IsActive
                FROM [{schema}].[Users] u
                WHERE u.UserId = :uid
            """),
            {"uid": uid},
        ).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="User not found")

        # Fetch current roles and active SystemAdmin count once, before any mutations,
        # so all guards evaluate against the pre-UPDATE state of the database.
        target_current_roles = conn.execute(
            text(f"""
                SELECT r.RoleName FROM [{schema}].[UserRoles] ur
                JOIN [{schema}].[Roles] r ON r.RoleId = ur.RoleId
                WHERE ur.UserId = :uid
            """),
            {"uid": uid},
        ).fetchall()
        target_is_system_admin = any(r[0] == "SystemAdmin" for r in target_current_roles)
        sa_count = _count_active_system_admins(conn, schema) if target_is_system_admin else None

        # Build the SET clause dynamically from provided fields only
        updates: dict[str, object] = {}
        if body.username is not None:
            # Uniqueness check — exclude the target user from the check
            clash = conn.execute(
                text(f"""
                    SELECT 1 FROM [{schema}].[Users]
                    WHERE Username = :username AND UserId != :uid
                """),
                {"username": body.username, "uid": uid},
            ).fetchone()
            if clash:
                raise HTTPException(status_code=409, detail="Username already in use")
            updates["Username"] = body.username

        if body.email is not None:
            clash = conn.execute(
                text(f"""
                    SELECT 1 FROM [{schema}].[Users]
                    WHERE Email = :email AND UserId != :uid
                """),
                {"email": body.email, "uid": uid},
            ).fetchone()
            if clash:
                raise HTTPException(status_code=409, detail="Email already in use")
            updates["Email"] = body.email

        if body.is_active is not None:
            # Cannot deactivate yourself
            if not body.is_active and uid == user["user_id"]:
                raise HTTPException(status_code=403, detail="You cannot deactivate your own account")
            # Cannot deactivate the last active SystemAdmin
            if not body.is_active and target_is_system_admin:
                if sa_count is not None and sa_count <= 1:
                    raise HTTPException(
                        status_code=403,
                        detail="Cannot deactivate the last active SystemAdmin",
                    )
            updates["IsActive"] = 1 if body.is_active else 0

        if updates:
            if not updates.keys() <= PATCHABLE_COLUMNS:
                raise HTTPException(status_code=500, detail="Internal error")
            set_clause = ", ".join(f"[{col}] = :{col}" for col in updates)
            params = {**updates, "uid": uid, "mid": user["user_id"], "now": now}
            conn.execute(
                text(f"""
                    UPDATE [{schema}].[Users]
                    SET {set_clause}, ModifiedById = :mid, ModifiedDate = :now
                    WHERE UserId = :uid
                """),
                params,
            )

        # Role update: replace existing role with the new one (DELETE + INSERT)
        if body.role is not None:
            role_id = _fetch_role_id(conn, schema, body.role)

            # Prevent role change that would leave no active SystemAdmin.
            # Uses the pre-UPDATE sa_count to avoid a false 403 when is_active=false
            # is submitted alongside the role demotion in the same request.
            if target_is_system_admin and body.role != "SystemAdmin":
                if sa_count is not None and sa_count <= 1:
                    raise HTTPException(
                        status_code=403,
                        detail="Cannot change the role of the last active SystemAdmin",
                    )

            conn.execute(
                text(f"DELETE FROM [{schema}].[UserRoles] WHERE UserId = :uid"),
                {"uid": uid},
            )
            conn.execute(
                text(f"""
                    INSERT INTO [{schema}].[UserRoles]
                        (UserId, RoleId, AssignedDate,
                         CreatedById, CreatedDate, ModifiedById, ModifiedDate)
                    VALUES
                        (:uid, :rid, :now,
                         :cid, :now, :cid, :now)
                """),
                {"uid": uid, "rid": role_id, "cid": user["user_id"], "now": now},
            )

    return {"id": uid}


# ---------------------------------------------------------------------------
# DELETE /api/users/{user_id}
# ---------------------------------------------------------------------------


@router.delete("/{user_id}", status_code=204)
def deactivate_user(user_id: str, user: dict = Depends(verify_token)):
    _require_system_admin(user)
    uid = _parse_user_id(user_id)

    if uid == user["user_id"]:
        raise HTTPException(status_code=403, detail="You cannot deactivate your own account")

    config, engine = get_config_and_engine()
    schema = config.schema
    now = datetime.now(timezone.utc)

    with engine.begin() as conn:
        existing = conn.execute(
            text(f"""
                SELECT u.IsActive FROM [{schema}].[Users] WHERE UserId = :uid
            """),
            {"uid": uid},
        ).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="User not found")
        if not existing[0]:
            raise HTTPException(status_code=409, detail="User is already inactive")

        # Cannot deactivate the last active SystemAdmin
        current_roles = conn.execute(
            text(f"""
                SELECT r.RoleName FROM [{schema}].[UserRoles] ur
                JOIN [{schema}].[Roles] r ON r.RoleId = ur.RoleId
                WHERE ur.UserId = :uid
            """),
            {"uid": uid},
        ).fetchall()
        is_system_admin = any(r[0] == "SystemAdmin" for r in current_roles)
        if is_system_admin:
            sa_count = _count_active_system_admins(conn, schema)
            if sa_count <= 1:
                raise HTTPException(
                    status_code=403,
                    detail="Cannot deactivate the last active SystemAdmin",
                )

        conn.execute(
            text(f"""
                UPDATE [{schema}].[Users]
                SET IsActive = 0, ModifiedById = :mid, ModifiedDate = :now
                WHERE UserId = :uid
            """),
            {"mid": user["user_id"], "now": now, "uid": uid},
        )
