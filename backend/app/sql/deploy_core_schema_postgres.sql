-- deploy_core_schema_postgres.sql
--
-- Deploys the admin-it core schema on PostgreSQL.
-- The literal string '__SCHEMA__' is replaced with the actual schema name
-- by the Python deployment code before execution.
--
-- Requirements:
--   * PostgreSQL 13+ (gen_random_uuid() built-in)
--   * The pgcrypto extension must be available so that gen_random_bytes()
--     can be used to seed JWT_SECRET.  The deploying user needs CREATE
--     EXTENSION rights, or a DBA must run `CREATE EXTENSION pgcrypto`
--     before running this script.
--   * The connecting user must have CREATE SCHEMA privileges.
--
-- This script is idempotent: safe to run multiple times on the same database.

-- Enable pgcrypto for gen_random_bytes() used in the JWT_SECRET seed.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Create schema if it does not already exist.
CREATE SCHEMA IF NOT EXISTS "__SCHEMA__";

-- ──────────────────────────────────────────────
-- CORE TABLES
-- ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "__SCHEMA__"."Users" (
    "UserId"      UUID         NOT NULL DEFAULT gen_random_uuid(),
    "Username"    VARCHAR(100) NOT NULL,
    "Email"       VARCHAR(255) NOT NULL,
    "IsActive"    BOOLEAN      NOT NULL DEFAULT TRUE,
    "PasswordHash" VARCHAR(512) NOT NULL,
    "CreatedById"  UUID,
    "CreatedDate"  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    "ModifiedById" UUID,
    "ModifiedDate" TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    PRIMARY KEY ("UserId"),
    UNIQUE ("Username"),
    UNIQUE ("Email")
);

CREATE TABLE IF NOT EXISTS "__SCHEMA__"."UserSecrets" (
    "UserSecretId" UUID         NOT NULL DEFAULT gen_random_uuid(),
    "UserId"       UUID         NOT NULL,
    "Salt"         VARCHAR(256) NOT NULL,
    "CreatedById"  UUID,
    "CreatedDate"  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    "ModifiedById" UUID,
    "ModifiedDate" TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    PRIMARY KEY ("UserSecretId"),
    FOREIGN KEY ("UserId") REFERENCES "__SCHEMA__"."Users" ("UserId")
);

CREATE TABLE IF NOT EXISTS "__SCHEMA__"."Roles" (
    "RoleId"      UUID         NOT NULL DEFAULT gen_random_uuid(),
    "RoleName"    VARCHAR(100) NOT NULL,
    "CreatedById"  UUID,
    "CreatedDate"  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    "ModifiedById" UUID,
    "ModifiedDate" TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    PRIMARY KEY ("RoleId"),
    UNIQUE ("RoleName")
);

CREATE TABLE IF NOT EXISTS "__SCHEMA__"."UserRoles" (
    "UserId"       UUID        NOT NULL,
    "RoleId"       UUID        NOT NULL,
    "AssignedDate" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "CreatedById"  UUID,
    "CreatedDate"  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "ModifiedById" UUID,
    "ModifiedDate" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY ("UserId", "RoleId"),
    FOREIGN KEY ("UserId") REFERENCES "__SCHEMA__"."Users" ("UserId"),
    FOREIGN KEY ("RoleId") REFERENCES "__SCHEMA__"."Roles" ("RoleId")
);

CREATE TABLE IF NOT EXISTS "__SCHEMA__"."Connections" (
    "ConnectionId"   UUID         NOT NULL DEFAULT gen_random_uuid(),
    "Name"           VARCHAR(255) NOT NULL,
    "ConnectionString" TEXT       NOT NULL,
    "IsActive"       BOOLEAN      NOT NULL DEFAULT TRUE,
    "CreatedById"    UUID,
    "CreatedDate"    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    "ModifiedById"   UUID,
    "ModifiedDate"   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    PRIMARY KEY ("ConnectionId"),
    UNIQUE ("Name")
);

CREATE TABLE IF NOT EXISTS "__SCHEMA__"."ConnectionPermissions" (
    "PermissionId"   UUID        NOT NULL DEFAULT gen_random_uuid(),
    "PermissionName" VARCHAR(50) NOT NULL,
    "CreatedById"    UUID,
    "CreatedDate"    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "ModifiedById"   UUID,
    "ModifiedDate"   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY ("PermissionId"),
    UNIQUE ("PermissionName")
);

CREATE TABLE IF NOT EXISTS "__SCHEMA__"."UserConnectionAccess" (
    "UserId"       UUID        NOT NULL,
    "ConnectionId" UUID        NOT NULL,
    "PermissionId" UUID        NOT NULL,
    "CreatedById"  UUID,
    "CreatedDate"  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "ModifiedById" UUID,
    "ModifiedDate" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY ("UserId", "ConnectionId"),
    FOREIGN KEY ("UserId")       REFERENCES "__SCHEMA__"."Users" ("UserId"),
    FOREIGN KEY ("ConnectionId") REFERENCES "__SCHEMA__"."Connections" ("ConnectionId"),
    FOREIGN KEY ("PermissionId") REFERENCES "__SCHEMA__"."ConnectionPermissions" ("PermissionId")
);

CREATE TABLE IF NOT EXISTS "__SCHEMA__"."Secrets" (
    "SecretId"          UUID         NOT NULL DEFAULT gen_random_uuid(),
    "SecretType"        VARCHAR(100) NOT NULL,
    "SecretDescription" VARCHAR(255),
    "SecretValue"       TEXT         NOT NULL,
    "CreatedById"       UUID,
    "CreatedDate"       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    "ModifiedById"      UUID,
    "ModifiedDate"      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    PRIMARY KEY ("SecretId"),
    UNIQUE ("SecretType")
);

-- ──────────────────────────────────────────────
-- COLUMN MASKS
-- ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "__SCHEMA__"."ColumnMasks" (
    "MaskId"       UUID         NOT NULL DEFAULT gen_random_uuid(),
    "ConnectionId" UUID         NOT NULL,
    "SchemaName"   VARCHAR(128) NOT NULL,
    "TableName"    VARCHAR(128) NOT NULL,
    "ColumnName"   VARCHAR(128) NOT NULL,
    "CreatedById"  UUID,
    "CreatedDate"  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    PRIMARY KEY ("MaskId"),
    UNIQUE ("ConnectionId", "SchemaName", "TableName", "ColumnName"),
    FOREIGN KEY ("ConnectionId") REFERENCES "__SCHEMA__"."Connections" ("ConnectionId")
);

-- ──────────────────────────────────────────────
-- SAVED QUERIES and QUERY PARAMETERS
-- ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "__SCHEMA__"."SavedQueries" (
    "SavedQueryId" UUID         NOT NULL DEFAULT gen_random_uuid(),
    "ConnectionId" UUID         NOT NULL,
    "Name"         VARCHAR(255) NOT NULL,
    "Description"  VARCHAR(1000),
    "QueryText"    TEXT         NOT NULL,
    "IsActive"     BOOLEAN      NOT NULL DEFAULT TRUE,
    "CreatedById"  UUID,
    "CreatedDate"  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    "ModifiedById" UUID,
    "ModifiedDate" TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    PRIMARY KEY ("SavedQueryId"),
    UNIQUE ("ConnectionId", "Name"),
    FOREIGN KEY ("ConnectionId") REFERENCES "__SCHEMA__"."Connections" ("ConnectionId"),
    FOREIGN KEY ("CreatedById")  REFERENCES "__SCHEMA__"."Users" ("UserId"),
    FOREIGN KEY ("ModifiedById") REFERENCES "__SCHEMA__"."Users" ("UserId")
);

CREATE TABLE IF NOT EXISTS "__SCHEMA__"."QueryParameters" (
    "ParameterId"   UUID         NOT NULL DEFAULT gen_random_uuid(),
    "SavedQueryId"  UUID         NOT NULL,
    "Name"          VARCHAR(100) NOT NULL,
    "Label"         VARCHAR(255) NOT NULL,
    "ParamType"     VARCHAR(20)  NOT NULL,
    "IsRequired"    BOOLEAN      NOT NULL DEFAULT TRUE,
    "DefaultValue"  VARCHAR(500),
    "SelectOptions" TEXT,
    "DisplayOrder"  INT          NOT NULL DEFAULT 0,
    PRIMARY KEY ("ParameterId"),
    UNIQUE ("SavedQueryId", "Name"),
    CONSTRAINT chk_query_param_type CHECK ("ParamType" IN ('text', 'number', 'date', 'boolean', 'select')),
    FOREIGN KEY ("SavedQueryId") REFERENCES "__SCHEMA__"."SavedQueries" ("SavedQueryId")
);

-- ──────────────────────────────────────────────
-- AUDIT LOG
-- ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "__SCHEMA__"."audit_log" (
    id          UUID         NOT NULL DEFAULT gen_random_uuid(),
    table_name  TEXT         NOT NULL,
    record_id   UUID,
    action      TEXT         NOT NULL,
    changed_by  UUID,
    changed_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    old_data    JSONB,
    new_data    JSONB,
    PRIMARY KEY (id),
    CONSTRAINT audit_log_action_check CHECK (action IN ('INSERT', 'UPDATE', 'DELETE', 'ACCESS', 'EXPORT'))
);

-- ──────────────────────────────────────────────
-- SETTINGS
-- Generic key/value table for application settings (e.g. SMTP config).
-- Values are JSON-encoded text. Mutable in place; audit at the route layer.
-- ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "__SCHEMA__"."Settings" (
    "SettingKey"   VARCHAR(100) NOT NULL PRIMARY KEY,
    "SettingValue" TEXT         NOT NULL,
    "UpdatedAt"    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    "UpdatedBy"    UUID
);

-- ──────────────────────────────────────────────
-- AUDIT TRIGGER FUNCTION
-- Shared by all audited tables.
-- Uses current_setting('app.current_user_id', true) to get the caller's
-- identity — set per-transaction by the SQLAlchemy 'begin' event listener
-- in PostgreSQLBackend.
-- ──────────────────────────────────────────────

CREATE OR REPLACE FUNCTION "__SCHEMA__"._audit_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_uid  UUID;
    v_rid  UUID;
BEGIN
    -- Retrieve the application user ID set at transaction start.
    -- current_setting(..., true) returns NULL instead of raising if unset.
    BEGIN
        v_uid := current_setting('app.current_user_id', true)::UUID;
    EXCEPTION WHEN OTHERS THEN
        v_uid := NULL;
    END;

    IF TG_OP = 'DELETE' THEN
        v_rid := CASE TG_TABLE_NAME
            WHEN 'Users'                THEN OLD."UserId"
            WHEN 'Connections'          THEN OLD."ConnectionId"
            WHEN 'ConnectionPermissions' THEN OLD."PermissionId"
            WHEN 'Secrets'              THEN OLD."SecretId"
            WHEN 'SavedQueries'         THEN OLD."SavedQueryId"
            ELSE NULL
        END;
        INSERT INTO "__SCHEMA__"."audit_log"
            (table_name, record_id, action, changed_by, old_data, new_data)
        VALUES
            (TG_TABLE_NAME, v_rid, 'DELETE', v_uid, to_jsonb(OLD), NULL);
        RETURN OLD;
    ELSE
        v_rid := CASE TG_TABLE_NAME
            WHEN 'Users'                THEN NEW."UserId"
            WHEN 'Connections'          THEN NEW."ConnectionId"
            WHEN 'ConnectionPermissions' THEN NEW."PermissionId"
            WHEN 'Secrets'              THEN NEW."SecretId"
            WHEN 'SavedQueries'         THEN NEW."SavedQueryId"
            ELSE NULL
        END;
        INSERT INTO "__SCHEMA__"."audit_log"
            (table_name, record_id, action, changed_by, old_data, new_data)
        VALUES (
            TG_TABLE_NAME,
            v_rid,
            TG_OP,
            v_uid,
            CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) ELSE NULL END,
            to_jsonb(NEW)
        );
        RETURN NEW;
    END IF;
END;
$$;

-- ──────────────────────────────────────────────
-- ATTACH TRIGGERS
-- One AFTER trigger per audited table.
-- DROP + CREATE is used instead of CREATE IF NOT EXISTS (not supported for
-- triggers in older Postgres versions) to keep the script idempotent.
-- ──────────────────────────────────────────────

DROP TRIGGER IF EXISTS _audit ON "__SCHEMA__"."Users";
CREATE TRIGGER _audit
    AFTER INSERT OR UPDATE OR DELETE ON "__SCHEMA__"."Users"
    FOR EACH ROW EXECUTE FUNCTION "__SCHEMA__"._audit_trigger();

DROP TRIGGER IF EXISTS _audit ON "__SCHEMA__"."Connections";
CREATE TRIGGER _audit
    AFTER INSERT OR UPDATE OR DELETE ON "__SCHEMA__"."Connections"
    FOR EACH ROW EXECUTE FUNCTION "__SCHEMA__"._audit_trigger();

DROP TRIGGER IF EXISTS _audit ON "__SCHEMA__"."ConnectionPermissions";
CREATE TRIGGER _audit
    AFTER INSERT OR UPDATE OR DELETE ON "__SCHEMA__"."ConnectionPermissions"
    FOR EACH ROW EXECUTE FUNCTION "__SCHEMA__"._audit_trigger();

DROP TRIGGER IF EXISTS _audit ON "__SCHEMA__"."Secrets";
CREATE TRIGGER _audit
    AFTER INSERT OR UPDATE OR DELETE ON "__SCHEMA__"."Secrets"
    FOR EACH ROW EXECUTE FUNCTION "__SCHEMA__"._audit_trigger();

DROP TRIGGER IF EXISTS _audit ON "__SCHEMA__"."SavedQueries";
CREATE TRIGGER _audit
    AFTER INSERT OR UPDATE OR DELETE ON "__SCHEMA__"."SavedQueries"
    FOR EACH ROW EXECUTE FUNCTION "__SCHEMA__"._audit_trigger();

-- ──────────────────────────────────────────────
-- SEED DATA
-- All inserts use ON CONFLICT DO NOTHING so the script is safe to re-run.
-- ──────────────────────────────────────────────

-- Roles
INSERT INTO "__SCHEMA__"."Roles" ("RoleId", "RoleName")
VALUES (gen_random_uuid(), 'SystemAdmin')
ON CONFLICT ("RoleName") DO NOTHING;

INSERT INTO "__SCHEMA__"."Roles" ("RoleId", "RoleName")
VALUES (gen_random_uuid(), 'Admin')
ON CONFLICT ("RoleName") DO NOTHING;

INSERT INTO "__SCHEMA__"."Roles" ("RoleId", "RoleName")
VALUES (gen_random_uuid(), 'PowerUser')
ON CONFLICT ("RoleName") DO NOTHING;

INSERT INTO "__SCHEMA__"."Roles" ("RoleId", "RoleName")
VALUES (gen_random_uuid(), 'EndUser')
ON CONFLICT ("RoleName") DO NOTHING;

-- Connection permission types
INSERT INTO "__SCHEMA__"."ConnectionPermissions" ("PermissionId", "PermissionName")
VALUES
    (gen_random_uuid(), 'Read'),
    (gen_random_uuid(), 'Write'),
    (gen_random_uuid(), 'Admin')
ON CONFLICT ("PermissionName") DO NOTHING;

-- JWT secret (random 32-byte hex string; generated once, never overwritten)
INSERT INTO "__SCHEMA__"."Secrets"
    ("SecretId", "SecretType", "SecretDescription", "SecretValue")
VALUES (
    gen_random_uuid(),
    'JWT_SECRET',
    'Used to sign JWT tokens',
    encode(gen_random_bytes(32), 'hex')
)
ON CONFLICT ("SecretType") DO NOTHING;
