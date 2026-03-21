# backend/app/utils/secure_config.py

import os
import json
from pathlib import Path
from dotenv import load_dotenv
from cryptography.fernet import Fernet

# .env lives at backend/.env
ENV_PATH = Path(__file__).resolve().parents[2] / ".env"
load_dotenv(dotenv_path=ENV_PATH, override=False)

FERNET_KEY = os.getenv("CORE_FERNET_KEY")
if not FERNET_KEY:
    raise RuntimeError("Missing CORE_FERNET_KEY in .env")

fernet = Fernet(FERNET_KEY.encode())

# core_connection.enc lives at backend/core_connection.enc
CORE_PATH = Path(__file__).resolve().parents[2] / "core_connection.enc"


def save_core_config(data: dict) -> None:
    """Encrypts and writes the core-connection JSON."""
    token = fernet.encrypt(json.dumps(data).encode("utf-8"))
    CORE_PATH.write_bytes(token)


def load_core_config() -> dict:
    """Reads + decrypts core-connection JSON. Raises FileNotFoundError or InvalidToken."""
    token = CORE_PATH.read_bytes()
    clear = fernet.decrypt(token).decode("utf-8")
    return json.loads(clear)


def core_config_exists() -> bool:
    return CORE_PATH.exists()


def delete_core_config() -> None:
    if CORE_PATH.exists():
        CORE_PATH.unlink()
