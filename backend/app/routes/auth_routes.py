# backend/app/routes/auth_routes.py

from datetime import datetime, timedelta

import jwt as pyjwt  # PyJWT
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel
from sqlalchemy import text

from app import settings
from app.db import fetch_secret
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

    with engine.begin() as conn:
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

        if not verify_password(request.password, stored_hash, legacy_salt=salt):
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid username or password.")

        # Transparent migration: re-hash with argon2id if still on legacy SHA-256.
        if needs_rehash(stored_hash):
            new_hash = hash_password(request.password)
            conn.execute(
                text(f"""
                UPDATE [{schema}].[Users]
                SET PasswordHash = :new_hash
                WHERE UserId = :uid
            """),
                {"new_hash": new_hash, "uid": user_id},
            )

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
    expire_time = datetime.utcnow() + expires_delta
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
