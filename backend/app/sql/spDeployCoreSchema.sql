
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
