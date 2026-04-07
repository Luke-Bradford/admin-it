"""Centralised constants used across routes and (future) scheduler.

Single source of truth for limits, caps, and tunables that would otherwise
be duplicated across modules. New constants land here when they need to be
referenced from more than one place.
"""

# Maximum rows returned by a single export request (CSV / XLSX) and by a
# single scheduled-run delivery. Was previously duplicated in
# data_routes.py and query_routes.py; consolidated here so changing it
# (or referencing it from the future scheduler runner) only touches one
# location.
MAX_EXPORT_ROWS = 10_000
