# app/main.py

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.routes.setup_routes import router as setup_router
from app.routes.discovery_routes import router as discovery_router

app = FastAPI()

@app.get("/ping")
def ping():
    return {"message": "pong"}

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
