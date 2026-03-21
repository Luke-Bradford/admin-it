# app/main.py

import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import settings
from app.db import fetch_secret
from app.routes.auth_routes import router as auth_router
from app.routes.discovery_routes import router as discovery_router
from app.routes.manage_routes import router as manage_router
from app.routes.setup_routes import router as setup_router
from app.utils.db_helpers import init_engine
from app.utils.secure_config import core_config_exists


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup — only attempt if config exists; fresh installs start cleanly without it.
    if core_config_exists():
        try:
            config, engine = init_engine()
            secret = fetch_secret(engine, settings.SCHEMA_NAME, "JWT_SECRET")
            if not secret:
                raise ValueError("JWT secret not found in the database.")
            settings.JWT_SECRET = secret
            print("[startup] Engine initialised and JWT secret loaded.")
        except Exception as e:
            # Log but do not crash — setup routes must remain reachable.
            print(f"[startup] Could not initialise engine or load JWT secret: {e}")
    else:
        print("[startup] No config file found. Starting in setup mode.")

    yield
    # Shutdown — nothing to clean up currently.


app = FastAPI(lifespan=lifespan)


@app.get("/ping")
def ping():
    return {"message": "pong"}


# CORS — origins loaded from env var, defaulting to localhost for local dev.
_cors_origins_raw = os.getenv("CORS_ORIGINS", "http://localhost:3000")
_cors_origins = [o.strip() for o in _cors_origins_raw.split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Route registration — always register all routers.
# Auth and role checks are enforced inside each endpoint via Depends(verify_token).
app.include_router(setup_router, prefix="/api/setup", tags=["Setup"])
app.include_router(discovery_router, prefix="/api/discover", tags=["Discovery"])
app.include_router(auth_router, prefix="/api/auth", tags=["Auth"])
app.include_router(manage_router, prefix="/api/manage", tags=["Manage"])
