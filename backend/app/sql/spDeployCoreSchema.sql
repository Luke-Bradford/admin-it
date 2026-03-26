
DECLARE @SchemaName NVARCHAR(100) = 'changeme';
DECLARE @sql NVARCHAR(MAX) = '';
DECLARE @crlf NVARCHAR(2) = CHAR(13) + CHAR(10);

SET NOCOUNT ON;

-- Create schema if missing
IF NOT EXISTS (SELECT * FROM sys.schemas WHERE name = @SchemaName)
BEGIN
    EXEC('CREATE SCHEMA [' + @SchemaName + ']');
END;

-------------------------------------
-- USERS table with temporal support
-------------------------------------
SET @sql += '
CREATE TABLE [' + @SchemaName + '].[Users] (
    UserId UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
    Username NVARCHAR(100) NOT NULL UNIQUE,
    Email NVARCHAR(255) NOT NULL UNIQUE,
    IsActive BIT NOT NULL DEFAULT 1,
    PasswordHash NVARCHAR(512) NOT NULL,
    CreatedById UNIQUEIDENTIFIER,
    CreatedDate DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    ModifiedById UNIQUEIDENTIFIER,
    ModifiedDate DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    ValidFrom DATETIME2 GENERATED ALWAYS AS ROW START HIDDEN NOT NULL,
    ValidTo DATETIME2 GENERATED ALWAYS AS ROW END HIDDEN NOT NULL,
    PERIOD FOR SYSTEM_TIME (ValidFrom, ValidTo)
) WITH (SYSTEM_VERSIONING = ON (HISTORY_TABLE = [' + @SchemaName + '].[UsersHistory]));
';

-----------------------------------------
-- USERSECRETS table with temporal support
-----------------------------------------
SET @sql += '
CREATE TABLE [' + @SchemaName + '].[UserSecrets] (
    UserSecretId UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
    UserId UNIQUEIDENTIFIER NOT NULL,
    Salt NVARCHAR(256) NOT NULL,
    CreatedById UNIQUEIDENTIFIER,
    CreatedDate DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    ModifiedById UNIQUEIDENTIFIER,
    ModifiedDate DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    ValidFrom DATETIME2 GENERATED ALWAYS AS ROW START HIDDEN NOT NULL,
    ValidTo DATETIME2 GENERATED ALWAYS AS ROW END HIDDEN NOT NULL,
    PERIOD FOR SYSTEM_TIME (ValidFrom, ValidTo),
    FOREIGN KEY (UserId) REFERENCES [' + @SchemaName + '].[Users](UserId)
) WITH (SYSTEM_VERSIONING = ON (HISTORY_TABLE = [' + @SchemaName + '].[UserSecretsHistory]));
';

-----------------------------------------
-- ROLES and USERROLES
-----------------------------------------
SET @sql += '
CREATE TABLE [' + @SchemaName + '].[Roles] (
    RoleId UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
    RoleName NVARCHAR(100) NOT NULL UNIQUE,
    CreatedById UNIQUEIDENTIFIER,
    CreatedDate DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    ModifiedById UNIQUEIDENTIFIER,
    ModifiedDate DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    ValidFrom DATETIME2 GENERATED ALWAYS AS ROW START HIDDEN NOT NULL,
    ValidTo DATETIME2 GENERATED ALWAYS AS ROW END HIDDEN NOT NULL,
    PERIOD FOR SYSTEM_TIME (ValidFrom, ValidTo)
) WITH (SYSTEM_VERSIONING = ON (HISTORY_TABLE = [' + @SchemaName + '].[RolesHistory]));
    
CREATE TABLE [' + @SchemaName + '].[UserRoles] (
    UserId UNIQUEIDENTIFIER NOT NULL,
    RoleId UNIQUEIDENTIFIER NOT NULL,
    AssignedDate DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    CreatedById UNIQUEIDENTIFIER,
    CreatedDate DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    ModifiedById UNIQUEIDENTIFIER,
    ModifiedDate DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    ValidFrom DATETIME2 GENERATED ALWAYS AS ROW START HIDDEN NOT NULL,
    ValidTo DATETIME2 GENERATED ALWAYS AS ROW END HIDDEN NOT NULL,
    PERIOD FOR SYSTEM_TIME (ValidFrom, ValidTo),
    PRIMARY KEY (UserId, RoleId),
    FOREIGN KEY (UserId) REFERENCES [' + @SchemaName + '].[Users](UserId),
    FOREIGN KEY (RoleId) REFERENCES [' + @SchemaName + '].[Roles](RoleId)
) WITH (SYSTEM_VERSIONING = ON (HISTORY_TABLE = [' + @SchemaName + '].[UserRolesHistory]));
';

-----------------------------------------
-- CONNECTIONS and PERMISSIONS
-----------------------------------------
SET @sql += '
CREATE TABLE [' + @SchemaName + '].[Connections] (
    ConnectionId UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
    Name NVARCHAR(255) NOT NULL UNIQUE,
    ConnectionString NVARCHAR(MAX) NOT NULL,
    IsActive BIT NOT NULL DEFAULT 1,
    CreatedById UNIQUEIDENTIFIER,
    CreatedDate DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    ModifiedById UNIQUEIDENTIFIER,
    ModifiedDate DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    ValidFrom DATETIME2 GENERATED ALWAYS AS ROW START HIDDEN NOT NULL,
    ValidTo DATETIME2 GENERATED ALWAYS AS ROW END HIDDEN NOT NULL,
    PERIOD FOR SYSTEM_TIME (ValidFrom, ValidTo)
) WITH (SYSTEM_VERSIONING = ON (HISTORY_TABLE = [' + @SchemaName + '].[ConnectionsHistory]));
    
CREATE TABLE [' + @SchemaName + '].[ConnectionPermissions] (
    PermissionId UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
    PermissionName NVARCHAR(50) NOT NULL UNIQUE,
    CreatedById UNIQUEIDENTIFIER,
    CreatedDate DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    ModifiedById UNIQUEIDENTIFIER,
    ModifiedDate DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    ValidFrom DATETIME2 GENERATED ALWAYS AS ROW START HIDDEN NOT NULL,
    ValidTo DATETIME2 GENERATED ALWAYS AS ROW END HIDDEN NOT NULL,
    PERIOD FOR SYSTEM_TIME (ValidFrom, ValidTo)
) WITH (SYSTEM_VERSIONING = ON (HISTORY_TABLE = [' + @SchemaName + '].[ConnectionPermissionsHistory]));

CREATE TABLE [' + @SchemaName + '].[UserConnectionAccess] (
    UserId UNIQUEIDENTIFIER NOT NULL,
    ConnectionId UNIQUEIDENTIFIER NOT NULL,
    PermissionId UNIQUEIDENTIFIER NOT NULL,
    CreatedById UNIQUEIDENTIFIER,
    CreatedDate DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    ModifiedById UNIQUEIDENTIFIER,
    ModifiedDate DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    ValidFrom DATETIME2 GENERATED ALWAYS AS ROW START HIDDEN NOT NULL,
    ValidTo DATETIME2 GENERATED ALWAYS AS ROW END HIDDEN NOT NULL,
    PERIOD FOR SYSTEM_TIME (ValidFrom, ValidTo),
    PRIMARY KEY (UserId, ConnectionId),
    FOREIGN KEY (UserId) REFERENCES [' + @SchemaName + '].[Users](UserId),
    FOREIGN KEY (ConnectionId) REFERENCES [' + @SchemaName + '].[Connections](ConnectionId),
    FOREIGN KEY (PermissionId) REFERENCES [' + @SchemaName + '].[ConnectionPermissions](PermissionId)
) WITH (SYSTEM_VERSIONING = ON (HISTORY_TABLE = [' + @SchemaName + '].[UserConnectionAccessHistory]));
';

-----------------------------------------
-- SECRETS
-----------------------------------------
SET @sql += '
CREATE TABLE [' + @SchemaName + '].[Secrets] (
    SecretId UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
    SecretType VARCHAR(100) NOT NULL,
    SecretDescription VARCHAR(255) NULL,
    SecretValue VARCHAR(MAX) NOT NULL,
    CreatedById UNIQUEIDENTIFIER,
    CreatedDate DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    ModifiedById UNIQUEIDENTIFIER,
    ModifiedDate DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    ValidFrom DATETIME2 GENERATED ALWAYS AS ROW START HIDDEN NOT NULL,
    ValidTo DATETIME2 GENERATED ALWAYS AS ROW END HIDDEN NOT NULL,
    PERIOD FOR SYSTEM_TIME (ValidFrom, ValidTo)
) WITH (SYSTEM_VERSIONING = ON (HISTORY_TABLE = [' + @SchemaName + '].[SecretsHistory]));
';

-----------------------------------------
-- AUDIT LOG
-- Not system-versioned: it is an append-only event log.
-- old_data / new_data stored as NVARCHAR(MAX) JSON.
-----------------------------------------
SET @sql += '
IF NOT EXISTS (SELECT 1 FROM sys.tables t
               JOIN sys.schemas s ON t.schema_id = s.schema_id
               WHERE s.name = ''' + @SchemaName + ''' AND t.name = ''audit_log'')
BEGIN
    CREATE TABLE [' + @SchemaName + '].[audit_log] (
        id            UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID(),
        table_name    NVARCHAR(100)    NOT NULL,
        record_id     UNIQUEIDENTIFIER NULL,
        action        NVARCHAR(10)     NOT NULL,
        changed_by    UNIQUEIDENTIFIER NULL,
        changed_at    DATETIME2        NOT NULL DEFAULT SYSUTCDATETIME(),
        old_data      NVARCHAR(MAX)    NULL,
        new_data      NVARCHAR(MAX)    NULL,
        PRIMARY KEY (id),
        CONSTRAINT chk_audit_log_action CHECK (action IN (''INSERT'', ''UPDATE'', ''DELETE''))
    );
END
';

-----------------------------------------
-- AUDIT TRIGGERS
-- One trigger per audited table.  Each trigger writes one row to audit_log
-- per statement (not per row) using FOR JSON AUTO.  The application user
-- identity is stored in SESSION_CONTEXT(N''app_user_id''), set by the
-- SQLAlchemy connection event in mssql_backend.py.
-- DROP + CREATE keeps the script idempotent.
-----------------------------------------
SET @sql += '
IF EXISTS (SELECT 1 FROM sys.triggers WHERE name = ''trg_audit_Users''
           AND parent_id = OBJECT_ID(''[' + @SchemaName + '].[Users]''))
    DROP TRIGGER [' + @SchemaName + '].[trg_audit_Users];
';
SET @sql += '
CREATE TRIGGER [' + @SchemaName + '].[trg_audit_Users]
ON [' + @SchemaName + '].[Users]
AFTER INSERT, UPDATE, DELETE
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @action NVARCHAR(10);
    IF EXISTS (SELECT 1 FROM inserted) AND EXISTS (SELECT 1 FROM deleted)
        SET @action = ''UPDATE'';
    ELSE IF EXISTS (SELECT 1 FROM inserted)
        SET @action = ''INSERT'';
    ELSE
        SET @action = ''DELETE'';

    DECLARE @uid UNIQUEIDENTIFIER = TRY_CAST(CAST(SESSION_CONTEXT(N''app_user_id'') AS NVARCHAR(36)) AS UNIQUEIDENTIFIER);
    DECLARE @rid UNIQUEIDENTIFIER = CASE @action WHEN ''DELETE'' THEN (SELECT TOP 1 UserId FROM deleted) ELSE (SELECT TOP 1 UserId FROM inserted) END;
    DECLARE @old NVARCHAR(MAX) = CASE WHEN @action IN (''UPDATE'', ''DELETE'') THEN (SELECT * FROM deleted FOR JSON AUTO) ELSE NULL END;
    DECLARE @new NVARCHAR(MAX) = CASE WHEN @action IN (''INSERT'', ''UPDATE'') THEN (SELECT * FROM inserted FOR JSON AUTO) ELSE NULL END;

    INSERT INTO [' + @SchemaName + '].[audit_log] (table_name, record_id, action, changed_by, old_data, new_data)
    VALUES (''Users'', @rid, @action, @uid, @old, @new);
END
';

SET @sql += '
IF EXISTS (SELECT 1 FROM sys.triggers WHERE name = ''trg_audit_Connections''
           AND parent_id = OBJECT_ID(''[' + @SchemaName + '].[Connections]''))
    DROP TRIGGER [' + @SchemaName + '].[trg_audit_Connections];
';
SET @sql += '
CREATE TRIGGER [' + @SchemaName + '].[trg_audit_Connections]
ON [' + @SchemaName + '].[Connections]
AFTER INSERT, UPDATE, DELETE
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @action NVARCHAR(10);
    IF EXISTS (SELECT 1 FROM inserted) AND EXISTS (SELECT 1 FROM deleted)
        SET @action = ''UPDATE'';
    ELSE IF EXISTS (SELECT 1 FROM inserted)
        SET @action = ''INSERT'';
    ELSE
        SET @action = ''DELETE'';

    DECLARE @uid UNIQUEIDENTIFIER = TRY_CAST(CAST(SESSION_CONTEXT(N''app_user_id'') AS NVARCHAR(36)) AS UNIQUEIDENTIFIER);
    DECLARE @rid UNIQUEIDENTIFIER = CASE @action WHEN ''DELETE'' THEN (SELECT TOP 1 ConnectionId FROM deleted) ELSE (SELECT TOP 1 ConnectionId FROM inserted) END;
    DECLARE @old NVARCHAR(MAX) = CASE WHEN @action IN (''UPDATE'', ''DELETE'') THEN (SELECT * FROM deleted FOR JSON AUTO) ELSE NULL END;
    DECLARE @new NVARCHAR(MAX) = CASE WHEN @action IN (''INSERT'', ''UPDATE'') THEN (SELECT * FROM inserted FOR JSON AUTO) ELSE NULL END;

    INSERT INTO [' + @SchemaName + '].[audit_log] (table_name, record_id, action, changed_by, old_data, new_data)
    VALUES (''Connections'', @rid, @action, @uid, @old, @new);
END
';

SET @sql += '
IF EXISTS (SELECT 1 FROM sys.triggers WHERE name = ''trg_audit_ConnectionPermissions''
           AND parent_id = OBJECT_ID(''[' + @SchemaName + '].[ConnectionPermissions]''))
    DROP TRIGGER [' + @SchemaName + '].[trg_audit_ConnectionPermissions];
';
SET @sql += '
CREATE TRIGGER [' + @SchemaName + '].[trg_audit_ConnectionPermissions]
ON [' + @SchemaName + '].[ConnectionPermissions]
AFTER INSERT, UPDATE, DELETE
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @action NVARCHAR(10);
    IF EXISTS (SELECT 1 FROM inserted) AND EXISTS (SELECT 1 FROM deleted)
        SET @action = ''UPDATE'';
    ELSE IF EXISTS (SELECT 1 FROM inserted)
        SET @action = ''INSERT'';
    ELSE
        SET @action = ''DELETE'';

    DECLARE @uid UNIQUEIDENTIFIER = TRY_CAST(CAST(SESSION_CONTEXT(N''app_user_id'') AS NVARCHAR(36)) AS UNIQUEIDENTIFIER);
    DECLARE @rid UNIQUEIDENTIFIER = CASE @action WHEN ''DELETE'' THEN (SELECT TOP 1 PermissionId FROM deleted) ELSE (SELECT TOP 1 PermissionId FROM inserted) END;
    DECLARE @old NVARCHAR(MAX) = CASE WHEN @action IN (''UPDATE'', ''DELETE'') THEN (SELECT * FROM deleted FOR JSON AUTO) ELSE NULL END;
    DECLARE @new NVARCHAR(MAX) = CASE WHEN @action IN (''INSERT'', ''UPDATE'') THEN (SELECT * FROM inserted FOR JSON AUTO) ELSE NULL END;

    INSERT INTO [' + @SchemaName + '].[audit_log] (table_name, record_id, action, changed_by, old_data, new_data)
    VALUES (''ConnectionPermissions'', @rid, @action, @uid, @old, @new);
END
';

SET @sql += '
IF EXISTS (SELECT 1 FROM sys.triggers WHERE name = ''trg_audit_Secrets''
           AND parent_id = OBJECT_ID(''[' + @SchemaName + '].[Secrets]''))
    DROP TRIGGER [' + @SchemaName + '].[trg_audit_Secrets];
';
SET @sql += '
CREATE TRIGGER [' + @SchemaName + '].[trg_audit_Secrets]
ON [' + @SchemaName + '].[Secrets]
AFTER INSERT, UPDATE, DELETE
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @action NVARCHAR(10);
    IF EXISTS (SELECT 1 FROM inserted) AND EXISTS (SELECT 1 FROM deleted)
        SET @action = ''UPDATE'';
    ELSE IF EXISTS (SELECT 1 FROM inserted)
        SET @action = ''INSERT'';
    ELSE
        SET @action = ''DELETE'';

    DECLARE @uid UNIQUEIDENTIFIER = TRY_CAST(CAST(SESSION_CONTEXT(N''app_user_id'') AS NVARCHAR(36)) AS UNIQUEIDENTIFIER);
    DECLARE @rid UNIQUEIDENTIFIER = CASE @action WHEN ''DELETE'' THEN (SELECT TOP 1 SecretId FROM deleted) ELSE (SELECT TOP 1 SecretId FROM inserted) END;
    -- SecretValue is intentionally excluded to prevent plaintext secrets appearing in the audit log.
    DECLARE @old NVARCHAR(MAX) = CASE WHEN @action IN (''UPDATE'', ''DELETE'') THEN (SELECT SecretId, SecretType, SecretDescription, CreatedById, CreatedDate, ModifiedById, ModifiedDate FROM deleted FOR JSON AUTO) ELSE NULL END;
    DECLARE @new NVARCHAR(MAX) = CASE WHEN @action IN (''INSERT'', ''UPDATE'') THEN (SELECT SecretId, SecretType, SecretDescription, CreatedById, CreatedDate, ModifiedById, ModifiedDate FROM inserted FOR JSON AUTO) ELSE NULL END;

    INSERT INTO [' + @SchemaName + '].[audit_log] (table_name, record_id, action, changed_by, old_data, new_data)
    VALUES (''Secrets'', @rid, @action, @uid, @old, @new);
END
';

-----------------------------------------
-- Seed Data for Roles and Permissions
-----------------------------------------
SET @sql += '
IF NOT EXISTS (SELECT 1 FROM [' + @SchemaName + '].[Roles] WHERE RoleName = ''SystemAdmin'')
    INSERT INTO [' + @SchemaName + '].[Roles] (RoleId, RoleName, CreatedById, CreatedDate, ModifiedById, ModifiedDate)
    VALUES (NEWID(), ''SystemAdmin'', NULL, SYSUTCDATETIME(), NULL, SYSUTCDATETIME());
    
IF NOT EXISTS (SELECT 1 FROM [' + @SchemaName + '].[ConnectionPermissions])
    BEGIN
        INSERT INTO [' + @SchemaName + '].[ConnectionPermissions] (PermissionId, PermissionName)
        VALUES (NEWID(), ''Read''), (NEWID(), ''Write''), (NEWID(), ''Admin'');
    END

IF NOT EXISTS (SELECT NULL FROM [' + @SchemaName + '].[Secrets] WHERE SecretType = ''JWT_SECRET'')
    INSERT INTO [' + @SchemaName + '].[Secrets] (SecretId, SecretType, SecretDescription, SecretValue)
    VALUES (NEWID(), ''JWT_SECRET'', ''Used to sign JWT tokens'', CONCAT('''', CONVERT(VARCHAR(MAX), CONVERT(VARBINARY(MAX), CRYPT_GEN_RANDOM(32)), 2)));
';

-- Execute the constructed SQL
EXEC sp_executesql @sql;
