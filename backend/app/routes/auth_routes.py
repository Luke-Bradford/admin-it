# backend/app/routes/auth_routes.py

from fastapi import APIRouter, HTTPException, status, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel
from sqlalchemy import text
from datetime import datetime, timedelta
import jwt as pyjwt  # PyJWT
import hashlib

from app import settings
from app.utils.db_helpers import get_config_and_engine
from app.db import fetch_secret

router = APIRouter()
security = HTTPBearer()


# Request model
class LoginRequest(BaseModel):
    username: str
    password: str


# Response model
class LoginResponse(BaseModel):
    token: str
    expires_at: datetime


# User Info model
class UserInfo(BaseModel):
    user_id: str
    username: str
    roles: list[str]


def hash_password(password: str, salt: str) -> str:
    return hashlib.sha256((password + salt).encode("utf-8")).hexdigest()


@router.post("/login", response_model=LoginResponse)
def login(request: LoginRequest):
    config, engine = get_config_and_engine()
    schema = config.schema

    with engine.connect() as conn:
        # Get user and hash
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

        if hash_password(request.password, salt) != stored_hash:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid username or password.")

        # Get roles
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

        # Load the secret from DB
        jwt_secret = fetch_secret(engine, schema, "JWT_SECRET")

        # Build JWT
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
