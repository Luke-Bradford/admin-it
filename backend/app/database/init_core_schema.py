# backend/app/database/init_core_schema.py

import os
import sys
import json
from datetime import datetime
from pathlib import Path

from dotenv import load_dotenv
from cryptography.fernet import Fernet

# allow import of your app package
SCRIPT_DIR = Path(__file__).parent
BACKEND_DIR = SCRIPT_DIR.parent.parent  # backend/app → backend
sys.path.insert(0, str(BACKEND_DIR))

from sqlalchemy import Column, Integer, String, DateTime, Boolean, Text, ForeignKey
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import relationship

from app.db import DatabaseConfig, get_engine

# ———————————————————————————————————————————————
# 1) Load & decrypt the core connection
# ———————————————————————————————————————————————

from app.utils.secure_config import load_core_config

# ———————————————————————————————————————————————
# 2) Define your core ORM models
# ———————————————————————————————————————————————

Base = declarative_base()


class CoreConnection(Base):
    __tablename__ = "core_connections"
    __table_args__ = {"schema": "adm"}

    id = Column(Integer, primary_key=True)
    name = Column(String(100), nullable=False, unique=True)
    host = Column(String(200), nullable=False)
    port = Column(Integer, default=1433, nullable=False)
    username = Column(String(100), nullable=False)
    password_enc = Column(Text, nullable=False)
    database = Column(String(100), nullable=False)
    schema = Column(String(100), default="adm", nullable=False)
    driver = Column(String(100), default="ODBC Driver 17 for SQL Server", nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)
    created_by = Column(Integer, nullable=True)
    updated_by = Column(Integer, nullable=True)


class User(Base):
    __tablename__ = "users"
    __table_args__ = {"schema": "adm"}

    id = Column(Integer, primary_key=True)
    name = Column(String(100), nullable=False)
    email = Column(String(200), unique=True, nullable=False)
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)
    created_by = Column(Integer, nullable=True)
    updated_by = Column(Integer, nullable=True)

    permissions = relationship("Permission", back_populates="user")


class Permission(Base):
    __tablename__ = "permissions"
    __table_args__ = {"schema": "adm"}

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("adm.users.id"), nullable=False)
    connection_id = Column(Integer, ForeignKey("adm.core_connections.id"), nullable=True)
    page = Column(String(200), nullable=True)
    can_read = Column(Boolean, default=False, nullable=False)
    can_write = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    user = relationship("User", back_populates="permissions")
    connection = relationship("CoreConnection")


# ———————————————————————————————————————————————
# 3) Bootstrap function
# ———————————————————————————————————————————————


def main():
    # 3a) Decrypt and load the core connection
    conn_info = load_core_config()
    db_config = DatabaseConfig(
        server=conn_info["db_host"],
        port=conn_info["db_port"],
        user=conn_info["db_user"],
        password=conn_info["db_password"],
        database=conn_info["db_name"],
        odbc_driver=conn_info["odbc_driver"],
        schema=conn_info["schema"],
    )

    # 3b) Get a pooled engine and create missing tables
    engine = get_engine(db_config)
    Base.metadata.create_all(engine)
    print("✅ Core tables ensured in schema 'adm':", [t.name for t in Base.metadata.sorted_tables])

    # TODO: Deploy views
    #    e.g. load .sql files from app/database/views/, then `engine.execute(text(sql))`

    # TODO: Deploy stored procedures
    #    e.g. load .sql files from app/database/procs/, then `engine.execute(text(sql))`


if __name__ == "__main__":
    main()
