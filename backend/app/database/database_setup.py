import pyodbc

class DatabaseSetup:
    def __init__(self, conn_str, schema="adm"):
        self.conn_str = conn_str
        self.schema = schema
        self.conn = None

    def connect(self):
        """Establish connection to the database."""
        self.conn = pyodbc.connect(self.conn_str)
        print(f"Connected to database.")

    def ensure_schema_exists(self):
        """Create schema if it does not exist."""
        cursor = self.conn.cursor()

        check_schema_sql = f"""
        IF NOT EXISTS (SELECT * FROM sys.schemas WHERE name = '{self.schema}')
        BEGIN
            EXEC('CREATE SCHEMA {self.schema}')
        END
        """

        cursor.execute(check_schema_sql)
        self.conn.commit()
        print(f"Schema '{self.schema}' verified or created.")

    def create_connections_table(self):
        """Create the Connections table inside the schema."""
        cursor = self.conn.cursor()

        create_table_sql = f"""
        IF NOT EXISTS (
            SELECT * 
            FROM INFORMATION_SCHEMA.TABLES 
            WHERE TABLE_SCHEMA = '{self.schema}' 
              AND TABLE_NAME = 'Connections'
        )
        BEGIN
            CREATE TABLE [{self.schema}].[Connections] (
                Id INT IDENTITY(1,1) PRIMARY KEY,
                Name NVARCHAR(255) NOT NULL,
                DbType NVARCHAR(50) NOT NULL,
                EncryptedHost NVARCHAR(MAX) NOT NULL,
                EncryptedPort NVARCHAR(MAX) NOT NULL,
                EncryptedUsername NVARCHAR(MAX) NOT NULL,
                EncryptedPassword NVARCHAR(MAX) NOT NULL,
                EncryptedDbName NVARCHAR(MAX) NOT NULL,
                CreatedAt DATETIME2 DEFAULT SYSUTCDATETIME(),
                ModifiedAt DATETIME2 DEFAULT SYSUTCDATETIME()
            )
        END
        """

        cursor.execute(create_table_sql)
        self.conn.commit()
        print(f"Table '{self.schema}.Connections' verified or created.")

    def close(self):
        """Close the database connection."""
        if self.conn:
            self.conn.close()
            print("Database connection closed.")

    def run_setup(self):
        """Full setup sequence."""
        self.connect()
        self.ensure_schema_exists()
        self.create_connections_table()
        self.close()

if __name__ == "__main__":
    # Example usage
    connection_string = (
        "DRIVER={ODBC Driver 17 for SQL Server};"
        "SERVER=localhost,1433;"
        "DATABASE=master;"
        "UID=sa;"
        "PWD=YourStrong!Passw0rd"
    )

    setup = DatabaseSetup(conn_str=connection_string, schema="adm")
    setup.run_setup()
