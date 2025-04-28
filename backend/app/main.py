from fastapi import FastAPI
from app.routes import setup_routes

app = FastAPI()

# Register the setup route
app.include_router(setup_routes.router)
