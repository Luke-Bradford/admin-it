# backend/app/utils/secure_string.py

from cryptography.fernet import Fernet

# WARNING: In production, move this key to an environment variable or a key vault
FERNET_KEY = Fernet.generate_key()
fernet = Fernet(FERNET_KEY)

def encrypt_connection_string (value: str) -> str:
    return fernet.encrypt(value.encode()).decode()

def decrypt_connection_string(value: str) -> str:
    return fernet.decrypt(value.encode()).decode()
