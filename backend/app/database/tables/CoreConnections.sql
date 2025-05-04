IF NOT EXISTS (
  SELECT 1
    FROM sys.tables t
    JOIN sys.schemas s ON t.schema_id = s.schema_id
   WHERE t.name = 'CoreConnections'
     AND s.name = '{schema}'
)
BEGIN
      CREATE TABLE {schema}.CoreConnections (
      Id            INT IDENTITY(1,1) PRIMARY KEY,
      Name          VARCHAR(100)    NOT NULL UNIQUE,
      Host          VARCHAR(200)    NOT NULL,
      Port          INT             NOT NULL DEFAULT 1433,
      Username      VARCHAR(100)    NOT NULL,
      PasswordEnc   VARCHAR(MAX)    NOT NULL,
      DatabaseName  VARCHAR(100)    NOT NULL,
      SchemaName    VARCHAR(100)    NOT NULL DEFAULT '{schema}',
      Driver        VARCHAR(100)    NOT NULL DEFAULT 'ODBC Driver 17 for SQL Server',
      CreatedAt     DATETIME2       NOT NULL DEFAULT SYSUTCDATETIME(),
      UpdatedAt     DATETIME2       NOT NULL DEFAULT SYSUTCDATETIME(),
      CreatedBy     INT             NULL,
      UpdatedBy     INT             NULL
    );
END
