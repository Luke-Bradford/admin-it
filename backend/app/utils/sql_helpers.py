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

    Raises ValueError for any unrecognised db_type so misuse (e.g. a config
    typo or an unsupported backend) fails loudly rather than silently returning
    bracket syntax that is invalid on non-MSSQL databases.
    """
    if db_type == "postgres":
        return f'"{schema}"."{table}"'
    if db_type == "mssql":
        return f"[{schema}].[{table}]"
    raise ValueError(f"Unknown db_type: {db_type!r}. Supported values: 'mssql', 'postgres'.")
