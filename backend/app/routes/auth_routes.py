# backend/app/routes/auth_routes.py

import logging
from datetime import datetime, timedelta, timezone

import jwt as pyjwt  # PyJWT
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, Field
from sqlalchemy import text

from app import settings
from app.db import fetch_secret
from app.utils.auth_dependency import verify_token
from app.utils.db_helpers import get_config_and_engine
from app.utils.password import hash_password, needs_rehash, verify_password

router = APIRouter()
security = HTTPBearer()


class LoginRequest(BaseModel):
    username: str
    password: str


class LoginResponse(BaseModel):
    token: str
    expires_at: datetime


class UserInfo(BaseModel):
    user_id: str
    username: str
    roles: list[str]


@router.post("/login", response_model=LoginResponse)
def login(request: LoginRequest):
    config, engine = get_config_and_engine()
    schema = config.schema

    # 1. Fetch credentials — separate connection from the rehash write below.
    with engine.connect() as conn:
        user_result = conn.execute(
            text(f"""
            SELECT u.UserId, u.Username, u.PasswordHash, us.Salt
            FROM [{schema}].[Users] u
            JOIN [{schema}].[UserSecrets] us ON u.UserId = us.UserId
            WHERE u.Username = :username
        """),
            {"username": request.username},
        ).fetchone()

    if not user_result:
        raise HTTPException(status_code=401, detail="Invalid username or password.")

    user_id, username, stored_hash, salt = user_result

    if not verify_password(request.password, stored_hash, salt):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid username or password.")

    # 2. Transparent migration: if the stored hash is SHA-256, rehash to argon2id.
    #    Both UPDATEs (PasswordHash and Salt) are inside the same engine.begin()
    #    transaction — they commit atomically or both roll back. If the process is
    #    killed between commit and token delivery the user will have an argon2id hash
    #    with a non-empty Salt, but needs_rehash() inspects only the hash string format
    #    (not Salt), so next login takes the argon2id path and succeeds. Salt becomes
    #    a dangling orphan with no functional impact.
    if needs_rehash(stored_hash):
        try:
            new_hash = hash_password(request.password)
            with engine.begin() as conn:
                conn.execute(
                    text(f"""
                    UPDATE [{schema}].[Users]
                    SET PasswordHash = :new_hash
                    WHERE UserId = :uid
                """),
                    {"new_hash": new_hash, "uid": user_id},
                )
                # Salt is no longer used for argon2id — clear it to signal migration complete.
                conn.execute(
                    text(f"""
                    UPDATE [{schema}].[UserSecrets]
                    SET Salt = ''
                    WHERE UserId = :uid
                """),
                    {"uid": user_id},
                )
        except Exception as rehash_err:
            # Rehash failure is non-fatal — user is still logged in with SHA-256 this time.
            # Log so an operator can see if migrations are silently failing in production.
            logging.getLogger(__name__).warning("SHA-256 → argon2id rehash failed for user %s: %s", user_id, rehash_err)

    # 3. Fetch roles in a separate query.
    with engine.connect() as conn:
        roles_result = conn.execute(
            text(f"""
            SELECT r.RoleName
            FROM [{schema}].[UserRoles] ur
            JOIN [{schema}].[Roles] r ON ur.RoleId = r.RoleId
            WHERE ur.UserId = :user_id
        """),
            {"user_id": user_id},
        ).fetchall()

    roles = [row[0] for row in roles_result] if roles_result else []

    jwt_secret = fetch_secret(engine, schema, "JWT_SECRET")

    expires_delta = timedelta(hours=settings.JWT_EXPIRES_HOURS)
    expire_time = datetime.now(timezone.utc) + expires_delta
    payload = {
        "sub": str(user_id),
        "username": username,
        "roles": roles,
        "exp": expire_time,
    }

    token = pyjwt.encode(payload, jwt_secret, algorithm=settings.JWT_ALGORITHM)

    return LoginResponse(token=token, expires_at=expire_time)


@router.get("/me", response_model=UserInfo)
def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)):
    token = credentials.credentials
    config, engine = get_config_and_engine()
    schema = config.schema
    jwt_secret = fetch_secret(engine, schema, "JWT_SECRET")

    try:
        payload = pyjwt.decode(token, jwt_secret, algorithms=[settings.JWT_ALGORITHM])
        user_id = payload.get("sub")
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    with engine.connect() as conn:
        user_result = conn.execute(
            text(f"""
            SELECT Username FROM [{schema}].[Users] WHERE UserId = :uid
        """),
            {"uid": user_id},
        ).fetchone()

        if not user_result:
            raise HTTPException(status_code=401, detail="User not found")

        roles_result = conn.execute(
            text(f"""
            SELECT r.RoleName
            FROM [{schema}].[UserRoles] ur
            JOIN [{schema}].[Roles] r ON ur.RoleId = r.RoleId
            WHERE ur.UserId = :uid
        """),
            {"uid": user_id},
        ).fetchall()

        roles = [r[0] for r in roles_result]

        return UserInfo(user_id=user_id, username=user_result.Username, roles=roles)


# ---------------------------------------------------------------------------
# POST /api/auth/change-password
# ---------------------------------------------------------------------------


class ChangePasswordRequest(BaseModel):
    current_password: str = Field(..., min_length=1)
    new_password: str = Field(..., min_length=12)


@router.post("/change-password", status_code=204)
def change_password(body: ChangePasswordRequest, user: dict = Depends(verify_token)):
    config, engine = get_config_and_engine()
    schema = config.schema
    uid = user["user_id"]

    with engine.begin() as conn:
        row = conn.execute(
            text(f"""
                SELECT u.PasswordHash, us.Salt
                FROM [{schema}].[Users] u
                JOIN [{schema}].[UserSecrets] us ON us.UserId = u.UserId
                WHERE u.UserId = :uid
            """),
            {"uid": uid},
        ).fetchone()

        if not row:
            raise HTTPException(status_code=404, detail="User not found")

        stored_hash, salt = row[0], row[1]

        if not verify_password(body.current_password, stored_hash, salt):
            raise HTTPException(status_code=400, detail="Current password is incorrect")

        new_hash = hash_password(body.new_password)

        conn.execute(
            text(f"""
                UPDATE [{schema}].[Users]
                SET PasswordHash = :new_hash, ModifiedDate = :now
                WHERE UserId = :uid
            """),
            {"new_hash": new_hash, "now": datetime.now(timezone.utc), "uid": uid},
        )

        # Ensure Salt is cleared (argon2id embeds salt in the hash string).
        conn.execute(
            text(f"UPDATE [{schema}].[UserSecrets] SET Salt = '' WHERE UserId = :uid"),
            {"uid": uid},
        )
