# app/main.py

import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import settings
from app.db import fetch_secret
from app.routes.auth_routes import router as auth_router
from app.routes.connections_routes import router as connections_router
from app.routes.discovery_routes import router as discovery_router
from app.routes.manage_routes import router as manage_router
from app.routes.setup_routes import router as setup_router
from app.utils.db_helpers import init_engine
from app.utils.secure_config import core_config_exists

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: attempt to load config and JWT secret.
    # Fails silently on a fresh install so that setup routes are reachable.
    if core_config_exists():
        try:
            config, engine = init_engine()
            secret = fetch_secret(engine, config.schema, "JWT_SECRET")
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
