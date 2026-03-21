# backend/app/utils/schema_manager.py

from pathlib import Path
from sqlalchemy import inspect
from sqlalchemy.schema import DDL

# point this at your backend/app/database folder
DDL_ROOT = Path(__file__).resolve().parents[1] / "database"

def load_sql_dir(subdir: str) -> dict[str, str]:
    """
    Read every .sql under database/{subdir} and return:
      { filename_without_ext : file_contents }.
    """
    out = {}
    folder = DDL_ROOT / subdir
    if not folder.exists():
        return out
    for sql_file in folder.glob("*.sql"):
        out[sql_file.stem] = sql_file.read_text(encoding="utf-8")
    return out

def get_expected_objects() -> dict[str, list[str]]:
    """
    Scan /database for the four subfolders and return a dict:
      {
        "tables":    [...],
        "views":     [...],
        "procs":     [...],
        "functions": [...]
      }
    """
    return {
        "tables":    list(load_sql_dir("tables").keys()),
        "views":     list(load_sql_dir("views").keys()),
        "procs":     list(load_sql_dir("procs").keys()),
        "functions": list(load_sql_dir("functions").keys()),
    }

def get_schema_changes(engine, schema: str) -> list[tuple]:
    """
    Compare ORM-defined tables (from app.models.Base) to the actual DB schema
    and return a list of actions:
      ("create_table",  <Table>),
      ("add_column",    <Table>, <Column>),
      ("alter_column",  <Table>, <Column>)
    """
    from app.models import Base

    insp    = inspect(engine)
    present = set(insp.get_table_names(schema=schema))
    changes = []

    # avoid sorted_tables (which tries to resolve FKs before tables exist)
    for tbl in Base.metadata.tables.values():
        if tbl.schema not in (None, schema):
            continue

        if tbl.name not in present:
            changes.append(("create_table", tbl))
            continue

        # compare columns
        existing = {c["name"]: c
                    for c in insp.get_columns(tbl.name, schema=schema)}
        for col in tbl.columns:
            if col.name not in existing:
                changes.append(("add_column", tbl, col))
            else:
                actual = existing[col.name]["type"]
                if str(col.type) != str(actual):
                    changes.append(("alter_column", tbl, col))

    return changes

def apply_schema_changes(engine, changes: list[tuple], schema: str):
    """
    Given the output of get_schema_changes(), run the necessary DDL:
     - For new tables, uses your SQL scripts in database/tables/{name}.sql
     - For add/alter columns, issues ALTER TABLE statements
    """
    table_sqls = load_sql_dir("tables")

    with engine.begin() as conn:
        for action, tbl, *rest in changes:
            if action == "create_table":
                sql = table_sqls[tbl.name].format(schema=schema)
                conn.execute(DDL(sql))

            elif action == "add_column":
                col = rest[0]
                typ = col.type.compile(engine.dialect)
                conn.execute(DDL(
                    f"ALTER TABLE {schema}.{tbl.name} "
                    f"ADD [{col.name}] {typ}"
                ))

            elif action == "alter_column":
                col = rest[0]
                typ = col.type.compile(engine.dialect)
                conn.execute(DDL(
                    f"ALTER TABLE {schema}.{tbl.name} "
                    f"ALTER COLUMN [{col.name}] {typ}"
                ))
