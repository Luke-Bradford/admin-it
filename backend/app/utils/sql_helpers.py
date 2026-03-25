# app/utils/sql_helpers.py
#
# Cross-dialect SQL identifier quoting.
# MSSQL uses [bracket] quoting; PostgreSQL uses "double-quote" quoting.
# Routes call quote_ident(schema, table, db_type) instead of hard-coding
# dialect-specific syntax, so the same route code works on both backends.


def quote_ident(schema: str, table: str, db_type: str) -> str:
    """Return a fully-qualified, dialect-quoted table identifier.

    Examples:
        quote_ident("adm", "Users", "mssql")    -> [adm].[Users]
        quote_ident("adm", "Users", "postgres")  -> "adm"."Users"
    """
    if db_type == "postgres":
        return f'"{schema}"."{table}"'
    # Default: MSSQL bracket quoting
    return f"[{schema}].[{table}]"
