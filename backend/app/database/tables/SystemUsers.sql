IF NOT EXISTS (
  SELECT 1
    FROM sys.tables t
    JOIN sys.schemas s ON t.schema_id = s.schema_id
   WHERE t.name = 'SystemUsers'
     AND s.name = '{schema}'
)
BEGIN
      CREATE TABLE {schema}.SystemUsers (
      Id            INT IDENTITY(1,1) PRIMARY KEY,
      Name          VARCHAR(100)     NOT NULL,
      EmailAddress  VARCHAR(200)     NOT NULL UNIQUE,
      IsActive      BIT              NOT NULL DEFAULT 1,
      CreatedAt     DATETIME2        NOT NULL DEFAULT SYSUTCDATETIME(),
      UpdatedAt     DATETIME2        NOT NULL DEFAULT SYSUTCDATETIME(),
      CreatedBy     INT              NULL,
      UpdatedBy     INT              NULL
    );
END