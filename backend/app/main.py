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


def _extract_uid(request: Request) -> str | None:
    """Decode the JWT bearer token and return the subject UUID, or None.

    Expiry is intentionally not verified — full validation happens inside
    each route via auth_dependency.  This is used only to populate the
    DB-level audit context so triggers can record who made each change.
    """
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer ") or not settings.JWT_SECRET:
        return None
    try:
        payload = pyjwt.decode(
            auth_header[len("Bearer ") :],
            settings.JWT_SECRET,
            algorithms=["HS256"],
            options={"verify_exp": False},
        )
        return payload.get("sub")
    except Exception:
        logger.debug("[set_db_user_context] JWT decode failed; audit context will be NULL", exc_info=True)
        return None


@app.middleware("http")
async def set_db_user_context(request: Request, call_next):
    """Populate the per-request ContextVar used by the audit trigger on both backends.

    Decodes the JWT (without verifying expiry — full validation happens inside
    the route via auth_dependency) to extract the user's UUID, then stores it
    via the active backend's set_current_user().

    - Postgres: propagated to app.current_user_id via set_config() in the 'begin' listener.
    - MSSQL: propagated to SESSION_CONTEXT(N'app_user_id') via sp_set_session_context.

    Skipped entirely if the backend is not yet initialised (fresh install, setup not complete).
    """
    try:
        from app.utils.db_helpers import get_backend  # noqa: PLC0415

        backend = get_backend()
    except Exception:
        return await call_next(request)

    try:
        if backend.db_type == "postgres":
            from app.backends.postgres_backend import reset_current_user, set_current_user  # noqa: PLC0415
        elif backend.db_type == "mssql":
            from app.backends.mssql_backend import reset_current_user, set_current_user  # noqa: PLC0415
        else:
            return await call_next(request)

        ctx_token = set_current_user(_extract_uid(request))
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
