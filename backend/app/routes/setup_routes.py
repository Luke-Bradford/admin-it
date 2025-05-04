# backend/app/routes/setup_routes.py

import os, json
from pathlib import Path
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
import pyodbc
from cryptography.fernet import Fernet, InvalidToken
from dotenv import load_dotenv
from sqlalchemy import inspect, text
from sqlalchemy.schema import DDL

from app.db import DatabaseConfig, get_engine, get_base
from app.utils.secure_config import (
    save_core_config,
    load_core_config,
    core_config_exists,
    delete_core_config,
)
from app.utils.schema_manager import (
    get_expected_objects,
    get_schema_changes,
    apply_schema_changes,
    load_sql_dir,
)

router = APIRouter()

# ————— AUTO‑GENERATE / LOAD FERNET KEY —————
ENV_PATH = Path(__file__).resolve().parents[2] / ".env"
if not ENV_PATH.exists() or "CORE_FERNET_KEY" not in os.environ:
    key = Fernet.generate_key().decode()
    with open(ENV_PATH, "a", encoding="utf-8") as f:
        f.write(f"\nCORE_FERNET_KEY={key}\n")
    os.environ["CORE_FERNET_KEY"] = key

load_dotenv(dotenv_path=ENV_PATH, override=False)
FERNET_KEY = os.getenv("CORE_FERNET_KEY")
if not FERNET_KEY:
    raise RuntimeError("Missing CORE_FERNET_KEY")
fernet = Fernet(FERNET_KEY.encode())

# ————— Pydantic model —————
class ConnDetails(BaseModel):
    db_host:     str
    db_port:     int
    db_user:     str
    db_password: str = Field(..., min_length=1)
    db_name:     str
    db_schema:   str = Field("adm", alias="schema")
    odbc_driver: str = Field(
        "ODBC Driver 17 for SQL Server",
        alias="odbc_driver"
    )

    class Config:
        allow_population_by_alias      = True
        allow_population_by_field_name = True

# ————— CORE SETUP APIs —————
@router.post("/test-connection")
async def test_connection(details: ConnDetails):
    cs = (
        f"DRIVER={{{details.odbc_driver}}};"
        f"SERVER={details.db_host},{details.db_port};"
        f"DATABASE={details.db_name};"
        f"UID={details.db_user};"
        f"PWD={details.db_password}"
        + (";Encrypt=yes;TrustServerCertificate=yes"
           if "18" in details.odbc_driver else "")
    )
    try:
        conn = pyodbc.connect(cs, timeout=5)
        conn.close()
        return {"status": "success", "message": "Connection OK"}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/setup")
async def setup(details: ConnDetails):
    # 1) verify creds
    await test_connection(details)

    # 2) build config+engine
    cfg    = DatabaseConfig(
        server      = details.db_host,
        port        = details.db_port,
        user        = details.db_user,
        password    = details.db_password,
        database    = details.db_name,
        odbc_driver = details.odbc_driver,
        schema      = details.db_schema,
    )
    engine = get_engine(cfg)

    # 3) **re‑bind your Base** to the chosen schema
    Base = get_base(cfg.schema)

    # 4) import your models _after_ Base is bound
    import app.models   # noqa: F401

    # 5) Bootstrap all ORM tables
    Base.metadata.create_all(engine)

    # 6) persist the encrypted config
    raw = details.dict(by_alias=True)
    save_core_config(raw)

    masked = raw.copy()
    masked["db_password"] = "*" * len(raw["db_password"])
    return {
        "configured": True,
        "connection": masked,
        "status":     "success",
        "message":    "Core initialized."
    }


@router.get("/setup")
async def get_setup():
    if not core_config_exists():
        return {"configured": False}
    try:
        data = load_core_config()
    except InvalidToken:
        delete_core_config()
        return {"configured": False}
    data["db_password"] = "*" * len(data["db_password"])
    return {"configured": True, "connection": data}


@router.delete("/setup")
async def delete_setup():
    delete_core_config()
    return {
        "configured": False,
        "status":     "success",
        "message":    "Deleted."
    }


# ————— SCHEMA STATUS —————
@router.get("/schema-status")
async def schema_status():
    if not core_config_exists():
        raise HTTPException(404, "Not configured")

    core = load_core_config()
    db   = DatabaseConfig(
        server      = core["db_host"],
        port        = core["db_port"],
        user        = core["db_user"],
        password    = core["db_password"],
        database    = core["db_name"],
        odbc_driver = core["odbc_driver"],
        schema      = core["schema"],
    )
    engine = get_engine(db)
    insp   = inspect(engine)

    present_tables = insp.get_table_names(schema=db.schema)
    present_views  = insp.get_view_names(schema=db.schema)

    with engine.connect() as conn:
        present_procs = conn.execute(
            text("SELECT name FROM sys.procedures WHERE SCHEMA_NAME(schema_id)=:s"),
            {"s": db.schema}
        ).scalars().all()
        present_funcs = conn.execute(
            text(
               "SELECT name FROM sys.objects "
               "WHERE type IN ('FN','IF','TF') AND SCHEMA_NAME(schema_id)=:s"
            ),
            {"s": db.schema}
        ).scalars().all()

    expected = get_expected_objects()
    missing = {
        "tables":     [t for t in expected["tables"]     if t not in present_tables],
        "views":      [v for v in expected["views"]      if v not in present_views],
        "procedures":[p for p in expected["procs"]      if p not in present_procs],
        "functions": [f for f in expected["functions"]  if f not in present_funcs],
    }
    return {"missing": missing}


# ————— DEPLOY SCHEMA —————
@router.post("/deploy")
async def deploy_schema():
    if not core_config_exists():
        raise HTTPException(404, "Core database not configured.")

    core = load_core_config()
    db   = DatabaseConfig(
        server      = core["db_host"],
        port        = core["db_port"],
        user        = core["db_user"],
        password    = core["db_password"],
        database    = core["db_name"],
        odbc_driver = core["odbc_driver"],
        schema      = core["schema"],
    )
    engine = get_engine(db)

    # 1) re‑bind and import your ORM Base + models
    Base = get_base(db.schema)
    import app.models   # noqa: F401

    # 2) create any missing tables + incremental columns
    Base.metadata.create_all(engine)
    changes = get_schema_changes(engine, db.schema)
    if changes:
        apply_schema_changes(engine, changes, db.schema)

    # 3) raw SQL scripts in strict order
    tables_sql    = load_sql_dir("tables")
    views_sql     = load_sql_dir("views")
    functions_sql = load_sql_dir("functions")
    procs_sql     = load_sql_dir("procs")

    with engine.begin() as conn:
        for sql in tables_sql.values():
            conn.execute(DDL(sql.format(schema=db.schema)))
        for sql in views_sql.values():
            conn.execute(DDL(sql.format(schema=db.schema)))
        for sql in functions_sql.values():
            conn.execute(DDL(sql.format(schema=db.schema)))
        for sql in procs_sql.values():
            conn.execute(DDL(sql.format(schema=db.schema)))

    return {"status": "success", "message": "Core schema deployed."}
