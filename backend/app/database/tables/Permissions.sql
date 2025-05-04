IF NOT EXISTS (
  SELECT 1
    FROM sys.tables t
    JOIN sys.schemas s ON t.schema_id = s.schema_id
   WHERE t.name = 'Permissions'
     AND s.name = '{schema}'
)
BEGIN
      CREATE TABLE {schema}.Permissions (
      Id             INT IDENTITY(1,1) PRIMARY KEY,
      UserId         INT              NOT NULL,
      ConnectionId   INT              NULL,
      PageName       VARCHAR(200)     NULL,
      CanRead        BIT              NOT NULL DEFAULT 0,
      CanWrite       BIT              NOT NULL DEFAULT 0,
      CreatedAt      DATETIME2        NOT NULL DEFAULT SYSUTCDATETIME(),
      CONSTRAINT FK_Permissions_User       FOREIGN KEY(UserId)       REFERENCES {schema}.SystemUsers(Id),
      CONSTRAINT FK_Permissions_Connection FOREIGN KEY(ConnectionId) REFERENCES {schema}.CoreConnections(Id)
    );
END
