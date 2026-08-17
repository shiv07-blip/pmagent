-- Runs once on first container boot (docker-entrypoint-initdb.d)
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Application roles (must match 0001_init.sql — docker init runs before migrations):
--  * pmagent_api     - user-facing API. tenant scope set per request via app.tenant_id.
--  * pmagent_worker  - service role (workers bypass RLS deliberately; they scope queries themselves).
CREATE ROLE pmagent_api LOGIN PASSWORD 'pmagent_api' NOINHERIT;
CREATE ROLE pmagent_worker LOGIN PASSWORD 'pmagent_worker' NOINHERIT BYPASSRLS;

GRANT CONNECT ON DATABASE pmagent TO pmagent_api, pmagent_worker;
GRANT USAGE ON SCHEMA public TO pmagent_api, pmagent_worker;
