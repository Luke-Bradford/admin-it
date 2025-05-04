CREATE OR ALTER PROCEDURE {schema}.prc_RefreshStats
AS
BEGIN
  SET NOCOUNT ON;

  MERGE INTO {schema}.UserConnectionSummary AS Target
  USING (
    SELECT
      u.Id           AS UserId,
      CAST(GETUTCDATE() AS DATE) AS SummaryDate,
      COUNT(c.Id)    AS ConnectionCount
    FROM {schema}.SystemUsers AS u
    LEFT JOIN {schema}.CoreConnections AS c
      ON c.CreatedBy = u.Id
    GROUP BY u.Id
  ) AS Source
    ON (
      Target.UserId      = Source.UserId
      AND Target.SummaryDate = Source.SummaryDate
    )
  WHEN MATCHED THEN
    UPDATE SET Target.ConnectionCount = Source.ConnectionCount
  WHEN NOT MATCHED THEN
    INSERT (UserId, SummaryDate, ConnectionCount)
    VALUES (Source.UserId, Source.SummaryDate, Source.ConnectionCount);
END;
