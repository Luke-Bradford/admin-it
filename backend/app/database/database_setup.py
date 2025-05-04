# backend/app/database/database_setup.py
import logging

from sqlalchemy import inspect
from sqlalchemy.exc import SQLAlchemyError

from app.db import DatabaseConfig, get_engine, test_connection
# Replace the following import with your actual Base metadata
from app.models import Base  


def init_core_database():
    """
    Initialize the core database schema if it doesn't exist.
    """
    config = DatabaseConfig()
    if not config.is_complete():
        raise RuntimeError("Incomplete database configuration. Check environment variables.")

    try:
        engine = get_engine(config)
    except RuntimeError as e:
        logging.error(f"Failed to create engine: {e}")
        raise

    if not test_connection(engine):
        raise RuntimeError("Cannot connect to core database. Verify credentials and network connectivity.")

    inspector = inspect(engine)
    # Check for an example core table; replace 'core_meta' with your table name
    if not inspector.has_table('core_meta'):
        logging.info("Core database tables not found; creating schema...")
        Base.metadata.create_all(bind=engine)
        logging.info("Core database schema initialized successfully.")
    else:
        logging.info("Core database already initialized; skipping creation.")


if __name__ == '__main__':
    logging.basicConfig(level=logging.INFO)
    try:
        init_core_database()
    except Exception as e:
        logging.error(f"Database setup failed: {e}")
        raise
