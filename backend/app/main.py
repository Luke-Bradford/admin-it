# app/main.py

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.routes.setup_routes import router as setup_router
from app.routes.discovery_routes import router as discovery_router
from app.routes.auth_routes import router as auth_router
from app import settings
from app.db import DatabaseConfig, get_engine, fetch_secret
from app.utils.db_helpers import get_config_and_engine

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
