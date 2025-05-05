# backend/app/settings.py

import os

SCHEMA_NAME = os.getenv("SCHEMA_NAME", "adm")  # Fallback default
JWT_ALGORITHM = "HS256"
JWT_EXPIRES_HOURS = 2

# Placeholder — to be loaded during app startup
JWT_SECRET = None
