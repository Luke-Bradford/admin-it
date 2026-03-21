# backend/app/utils/auth_dependency.py

import jwt as pyjwt
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import text

from app import settings
from app.utils.db_helpers import get_config_and_engine

security = HTTPBearer()


def verify_token(credentials: HTTPAuthorizationCredentials = Depends(security)):
    token = credentials.credentials
    try:
        payload = pyjwt.decode(token, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM])
        user_id = payload.get("sub")
        if not user_id:
            raise HTTPException(status_code=401, detail="Invalid token: missing user ID")
    except pyjwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except pyjwt.PyJWTError:
        raise HTTPException(status_code=401, detail="Invalid token")

    try:
        config, engine = get_config_and_engine()
    except RuntimeError:
        raise HTTPException(status_code=503, detail="Service unavailable: setup not complete")

    schema = config.schema

    with engine.connect() as conn:
        result = conn.execute(
            text(f"""
            SELECT u.Username, u.IsActive, r.RoleName
            FROM [{schema}].[Users] u
            LEFT JOIN [{schema}].[UserRoles] ur ON u.UserId = ur.UserId
            LEFT JOIN [{schema}].[Roles] r ON ur.RoleId = r.RoleId
            WHERE u.UserId = :uid
        """),
            {"uid": user_id},
        ).fetchall()

        if not result:
            raise HTTPException(status_code=403, detail="User not found")

        username, is_active = result[0][0], result[0][1]
        roles = list({row[2] for row in result if row[2] is not None})

        if not is_active:
            raise HTTPException(status_code=403, detail="User is inactive")

    return {
        "user_id": user_id,
        "username": username,
        "roles": roles,
    }
