CREATE OR ALTER VIEW {schema}.vw_UserStats AS
SELECT
  u.Id           AS UserId,
  u.Name         AS UserName,
  COUNT(c.Id)    AS ConnectionCount
FROM {schema}.SystemUsers AS u
LEFT JOIN {schema}.CoreConnections AS c
  ON c.CreatedBy = u.Id
GROUP BY
  u.Id, u.Name;
