from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.routes import setup_routes

app = FastAPI()

@app.get("/ping")
def ping():
    return {"message": "pong"}

# Allow frontend to reach backend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],  # <-- front-end address
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include setup API route
app.include_router(setup_routes.router, prefix="/api")
