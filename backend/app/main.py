# app/main.py

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.routes.setup_routes import router as setup_router
from app.routes.discovery_routes import router as discovery_router
from app.routes.auth_routes import router as auth_router
from app import settings
from app.db import fetch_secret
from app.utils.db_helpers import get_config_and_engine
from app.routes.manage_routes import router as manage_router
from app.utils.secure_config import core_config_exists
from app.database.database_setup import is_core_schema_deployed


app = FastAPI()

@app.get("/ping")
def ping():
    return {"message": "pong"}

@app.on_event("startup")
def load_jwt_secret():
    try:
        config, engine = get_config_and_engine()
        secret = fetch_secret(engine, settings.SCHEMA_NAME, "JWT_SECRET")
        if not secret:
            raise ValueError("JWT secret not found in the database.")
        settings.JWT_SECRET = secret
        print("[startup] JWT secret loaded successfully.")
    except Exception as e:
        print(f"[startup] Failed to load JWT secret: {e}")
        raise e  # Let FastAPI crash early if critical setup fails

# CORS setup
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],  # Adjust for prod if needed
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Route registration with distinct prefixes
app.include_router(setup_router, prefix="/api/setup", tags=["Setup"])
app.include_router(discovery_router, prefix="/api/discover", tags=["Discovery"])
app.include_router(auth_router, prefix="/api/auth", tags=["Auth"])
# Conditionally include protected routes
try:
    if core_config_exists():
        config, engine = get_config_and_engine()
        if is_core_schema_deployed(engine, schema=config.schema):
            app.include_router(manage_router, prefix="/api/manage", tags=["Manage"])
            print("[startup] Protected routes registered.")
        else:
            print("[startup] Core schema not deployed. Skipping protected routes.")
    else:
        print("[startup] No config file. Skipping protected routes.")
except Exception as e:
    print(f"[startup] Error loading protected routes: {e}")
