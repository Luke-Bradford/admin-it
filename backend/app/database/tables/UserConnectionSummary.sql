IF NOT EXISTS (
  SELECT 1
    FROM sys.tables t
    JOIN sys.schemas s ON t.schema_id = s.schema_id
   WHERE t.name = 'UserConnectionSummary'
     AND s.name = '{schema}'
)
BEGIN
      CREATE TABLE {schema}.UserConnectionSummary (
      UserId           INT   NOT NULL,
      SummaryDate      DATE  NOT NULL,
      ConnectionCount  INT   NOT NULL,
      CONSTRAINT PK_UserConnectionSummary PRIMARY KEY(UserId, SummaryDate)
    );
END