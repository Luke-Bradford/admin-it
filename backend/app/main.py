# app/main.py

import logging
import os
from contextlib import asynccontextmanager

import jwt as pyjwt
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from app import settings
from app.routes.audit_routes import router as audit_router
from app.routes.auth_routes import router as auth_router
from app.routes.connections_routes import router as connections_router
from app.routes.discovery_routes import router as discovery_router
from app.routes.manage_routes import router as manage_router
from app.routes.setup_routes import router as setup_router
from app.routes.users_routes import router as users_router
from app.utils.db_helpers import init_engine
from app.utils.secure_config import core_config_exists

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: attempt to load config and JWT secret.
    # Fails silently on a fresh install so that setup routes are reachable.
    if core_config_exists():
        try:
            backend = init_engine()
            secret = backend.fetch_secret("JWT_SECRET")
            if not secret:
                raise ValueError("JWT secret not found in the database.")
            settings.JWT_SECRET = secret
            logger.info("[startup] JWT secret loaded successfully.")
        except Exception as e:
            settings.JWT_SECRET = None
            logger.warning("[startup] Failed to load JWT secret: %s", e)
    else:
        settings.JWT_SECRET = None
        logger.info("[startup] No config file — setup not complete.")

    yield
    # Shutdown: nothing to clean up.


app = FastAPI(lifespan=lifespan)

# CORS origins loaded from environment variable.
# Set CORS_ORIGINS to a comma-separated list of allowed origins.
# Example: CORS_ORIGINS=http://localhost:3000,https://admin.example.com
_raw_origins = os.getenv("CORS_ORIGINS", "http://localhost:3000")
cors_origins = [o.strip() for o in _raw_origins.split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def set_db_user_context(request: Request, call_next):
    """Populate the per-request ContextVar used by the PostgreSQL audit trigger.

    Decodes the JWT (without verifying expiry — full validation happens inside
    the route via auth_dependency) to extract the user's UUID, then stores it
    via postgres_backend.set_current_user().  The PostgreSQL backend's 'begin'
    event listener reads this value and sets the Postgres session variable
    app.current_user_id so audit triggers can record who made each change.

    Skipped entirely when the active backend is not Postgres, so psycopg2 is
    never imported on MSSQL-only deployments.
    """
    try:
        from app.utils.db_helpers import get_backend  # noqa: PLC0415

        backend = get_backend()
    except Exception:
        return await call_next(request)

    if backend.db_type != "postgres":
        return await call_next(request)

    try:
        from app.backends.postgres_backend import reset_current_user, set_current_user  # noqa: PLC0415

        uid: str | None = None
        auth_header = request.headers.get("Authorization", "")
        if auth_header.startswith("Bearer ") and settings.JWT_SECRET:
            token = auth_header[len("Bearer ") :]
            try:
                payload = pyjwt.decode(
                    token,
                    settings.JWT_SECRET,
                    algorithms=["HS256"],
                    options={"verify_exp": False},
                )
                uid = payload.get("sub")
            except Exception:
                pass

        ctx_token = set_current_user(uid)
        try:
            return await call_next(request)
        finally:
            reset_current_user(ctx_token)
    except Exception:
        logger.warning("[set_db_user_context] Unexpected error in audit-context middleware", exc_info=True)
        return await call_next(request)


@app.get("/ping")
def ping():
    return {"message": "pong"}


# All routers registered unconditionally.
# Protected routes return 503 via auth_dependency if setup is not complete.
app.include_router(setup_router, prefix="/api/setup", tags=["Setup"])
app.include_router(discovery_router, prefix="/api/discover", tags=["Discovery"])
app.include_router(auth_router, prefix="/api/auth", tags=["Auth"])
app.include_router(manage_router, prefix="/api/manage", tags=["Manage"])
app.include_router(connections_router, prefix="/api/connections", tags=["Connections"])
app.include_router(users_router, prefix="/api/users", tags=["Users"])
app.include_router(audit_router, prefix="/api/audit", tags=["Audit"])
