-- Run once as a superuser on a fresh cluster (docker-compose runs it automatically).
-- Roles from docs/SPEC.md §7.10. Change the passwords outside local development.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rppc_migrator') THEN CREATE ROLE rppc_migrator LOGIN PASSWORD 'rppc_migrator'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user')      THEN CREATE ROLE app_user LOGIN PASSWORD 'app_user'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_client')    THEN CREATE ROLE app_client NOLOGIN; END IF;
END $$;
GRANT app_client TO app_user;                    -- lets app_user SET LOCAL ROLE app_client

CREATE DATABASE rppc      OWNER rppc_migrator;
CREATE DATABASE rppc_test OWNER rppc_migrator;
\c rppc
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
ALTER SCHEMA public OWNER TO rppc_migrator;
\c rppc_test
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
ALTER SCHEMA public OWNER TO rppc_migrator;
