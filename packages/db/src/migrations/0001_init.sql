-- 0001_init.sql — base schema + RLS
-- Runs as the `pmagent` superuser (docker init user). See packages/db/README.

-- Extensions -----------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Roles (idempotent; also created by infra/postgres/init.sql for docker)
-- Wrapped in exception handler for hosted Postgres (e.g. Neon) where role creation is restricted
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pmagent_api') THEN
    CREATE ROLE pmagent_api LOGIN PASSWORD 'pmagent_api' NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pmagent_worker') THEN
    CREATE ROLE pmagent_worker LOGIN PASSWORD 'pmagent_worker' NOINHERIT BYPASSRLS;
  END IF;
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'Skipping role creation (hosted Postgres) — using default role';
END $$;

-- Enums ----------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE ticket_source AS ENUM ('sms','email','portal','voice');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE request_status AS ENUM ('new','triaging','awaiting_info','work_order_created','scheduled','in_progress','completed','escalated','closed','cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE urgency AS ENUM ('emergency','urgent','routine','tenant_responsible');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE trade AS ENUM ('plumbing','hvac','electrical','appliance','structural','pest','lock','common','other');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE message_direction AS ENUM ('inbound','outbound');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE sender_type AS ENUM ('resident','ai','agent','owner','vendor','system');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE work_order_status AS ENUM ('proposed','assigned','accepted','scheduled','in_progress','completed','rejected','cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE role AS ENUM ('owner','admin','agent','readonly');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE tenant_status AS ENUM ('active','suspended');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE unit_status AS ENUM ('occupied','vacant','make_ready');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE lease_status AS ENUM ('active','expired','pending');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE audit_action AS ENUM ('request_created','message_received','message_sent','classification','escalation','emergency_alert','work_order_created','work_order_status','vendor_dispatch','owner_approval','resolve_first_touch','human_confirm','info_requested');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE doc_type AS ENUM ('policy','lease','faq');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE doc_status AS ENUM ('processing','ready','failed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE llm_run_status AS ENUM ('ok','error','timed_out');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Tables ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL,
  status tenant_status NOT NULL DEFAULT 'active',
  config jsonb NOT NULL DEFAULT '{}',
  llm_spend_month_usd numeric(12,2) NOT NULL DEFAULT 0,
  billing_month text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS tenants_slug_uq ON tenants (slug);

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  password_hash text NOT NULL,
  name text NOT NULL,
  phone text,
  timezone text NOT NULL DEFAULT 'UTC',
  is_platform_admin boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_uq ON users (email);

CREATE TABLE IF NOT EXISTS tenant_memberships (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id)
);

CREATE TABLE IF NOT EXISTS properties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  name text NOT NULL,
  address jsonb NOT NULL DEFAULT '{}',
  timezone text NOT NULL DEFAULT 'America/New_York',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS properties_tenant_idx ON properties (tenant_id);

CREATE TABLE IF NOT EXISTS units (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  property_id uuid NOT NULL REFERENCES properties(id),
  unit_number text NOT NULL,
  bedrooms integer,
  bathrooms integer,
  monthly_rent_cents integer NOT NULL DEFAULT 0,
  status unit_status NOT NULL DEFAULT 'vacant',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS units_tenant_idx ON units (tenant_id);
CREATE INDEX IF NOT EXISTS units_property_idx ON units (property_id);

CREATE TABLE IF NOT EXISTS residents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  name text NOT NULL,
  email text,
  phone text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS residents_tenant_idx ON residents (tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS residents_phone_uq ON residents (tenant_id, phone) WHERE phone IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS residents_email_uq ON residents (tenant_id, email) WHERE email IS NOT NULL;

CREATE TABLE IF NOT EXISTS leases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  unit_id uuid NOT NULL REFERENCES units(id),
  resident_id uuid NOT NULL REFERENCES residents(id),
  start_date timestamptz NOT NULL,
  end_date timestamptz NOT NULL,
  deposit_cents integer NOT NULL DEFAULT 0,
  monthly_rent_cents integer NOT NULL DEFAULT 0,
  status lease_status NOT NULL DEFAULT 'active',
  terms jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS leases_tenant_idx ON leases (tenant_id);
CREATE INDEX IF NOT EXISTS leases_unit_idx ON leases (unit_id);
CREATE INDEX IF NOT EXISTS leases_resident_idx ON leases (resident_id);

CREATE TABLE IF NOT EXISTS vendors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  name text NOT NULL,
  trades trade[] NOT NULL DEFAULT '{}',
  service_areas jsonb NOT NULL DEFAULT '{}',
  phone text,
  email text,
  hourly_rate_cents integer,
  emergency_capable boolean NOT NULL DEFAULT false,
  is_preferred boolean NOT NULL DEFAULT false,
  availability jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS vendors_tenant_idx ON vendors (tenant_id);
CREATE INDEX IF NOT EXISTS vendors_trades_idx ON vendors USING gin (trades);

CREATE TABLE IF NOT EXISTS maintenance_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  unit_id uuid NOT NULL REFERENCES units(id),
  resident_id uuid NOT NULL REFERENCES residents(id),
  source ticket_source NOT NULL,
  channel_thread_id text,
  subject text,
  body text NOT NULL,
  status request_status NOT NULL DEFAULT 'new',
  urgency urgency,
  category trade,
  confidence numeric(4,3),
  summary text,
  ai_notes jsonb NOT NULL DEFAULT '{}',
  photos jsonb NOT NULL DEFAULT '[]',
  first_ack_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS requests_tenant_status_idx ON maintenance_requests (tenant_id, status);
CREATE INDEX IF NOT EXISTS requests_unit_idx ON maintenance_requests (unit_id);
CREATE INDEX IF NOT EXISTS requests_resident_idx ON maintenance_requests (resident_id);
CREATE INDEX IF NOT EXISTS requests_created_idx ON maintenance_requests (tenant_id, created_at);

CREATE TABLE IF NOT EXISTS request_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  request_id uuid NOT NULL REFERENCES maintenance_requests(id) ON DELETE CASCADE,
  direction message_direction NOT NULL,
  channel ticket_source NOT NULL,
  body text NOT NULL,
  sender_type sender_type NOT NULL,
  sender_id uuid,
  media jsonb NOT NULL DEFAULT '[]',
  dedupe_key text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS messages_request_idx ON request_messages (request_id);
CREATE INDEX IF NOT EXISTS messages_tenant_idx ON request_messages (tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS messages_dedupe_uq ON request_messages (channel, dedupe_key) WHERE dedupe_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS work_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  request_id uuid NOT NULL REFERENCES maintenance_requests(id),
  vendor_id uuid NOT NULL REFERENCES vendors(id),
  status work_order_status NOT NULL DEFAULT 'proposed',
  est_cost_cents integer,
  actual_cost_cents integer,
  scheduled_at timestamptz,
  sla_response_minutes integer,
  notes text,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS work_orders_tenant_idx ON work_orders (tenant_id);
CREATE INDEX IF NOT EXISTS work_orders_request_idx ON work_orders (request_id);
CREATE INDEX IF NOT EXISTS work_orders_vendor_idx ON work_orders (vendor_id);

CREATE TABLE IF NOT EXISTS work_order_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  work_order_id uuid NOT NULL REFERENCES work_orders(id),
  event_type text NOT NULL,
  actor_type sender_type NOT NULL,
  actor_id uuid,
  payload jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS wo_events_wo_idx ON work_order_events (work_order_id);
CREATE INDEX IF NOT EXISTS wo_events_tenant_idx ON work_order_events (tenant_id);

CREATE TABLE IF NOT EXISTS request_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  request_id uuid NOT NULL REFERENCES maintenance_requests(id) ON DELETE CASCADE,
  action audit_action NOT NULL,
  actor_type sender_type NOT NULL,
  actor_id uuid,
  details jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_request_idx ON request_audit_log (request_id);
CREATE INDEX IF NOT EXISTS audit_tenant_idx ON request_audit_log (tenant_id, created_at);

CREATE TABLE IF NOT EXISTS llm_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  request_id uuid REFERENCES maintenance_requests(id),
  provider text NOT NULL,
  model text NOT NULL,
  status llm_run_status NOT NULL DEFAULT 'ok',
  prompt_tokens integer NOT NULL DEFAULT 0,
  completion_tokens integer NOT NULL DEFAULT 0,
  cost_usd numeric(12,6) NOT NULL DEFAULT 0,
  latency_ms integer NOT NULL DEFAULT 0,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS llm_runs_tenant_idx ON llm_runs (tenant_id);
CREATE INDEX IF NOT EXISTS llm_runs_created_idx ON llm_runs (created_at);
CREATE INDEX IF NOT EXISTS llm_runs_request_idx ON llm_runs (request_id);

CREATE TABLE IF NOT EXISTS policy_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  name text NOT NULL,
  doc_type doc_type NOT NULL,
  status doc_status NOT NULL DEFAULT 'processing',
  source_url text,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS policy_docs_tenant_idx ON policy_documents (tenant_id);

CREATE TABLE IF NOT EXISTS policy_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  document_id uuid NOT NULL REFERENCES policy_documents(id) ON DELETE CASCADE,
  chunk_index integer NOT NULL,
  content text NOT NULL,
  embedding vector(1536) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS policy_chunks_doc_idx ON policy_chunks (document_id);
CREATE INDEX IF NOT EXISTS policy_chunks_tenant_idx ON policy_chunks (tenant_id);
CREATE INDEX IF NOT EXISTS policy_chunks_embedding_idx ON policy_chunks USING hnsw (embedding vector_cosine_ops);

-- updated_at triggers ---------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['tenants','users','properties','units','residents','leases','vendors','maintenance_requests','work_orders','policy_documents']
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'set_updated_at' AND tgrelid = t::regclass) THEN
      EXECUTE format('CREATE TRIGGER set_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_at()', t);
    END IF;
  END LOOP;
END $$;

-- Row Level Security ----------------------------------------------------------
-- Runtime reads app.tenant_id / app.user_id (set per-transaction by the API)
-- and evaluates policies against them. Workers use BYPASSRLS and scope manually.

ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE properties ENABLE ROW LEVEL SECURITY;
ALTER TABLE units ENABLE ROW LEVEL SECURITY;
ALTER TABLE residents ENABLE ROW LEVEL SECURITY;
ALTER TABLE leases ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendors ENABLE ROW LEVEL SECURITY;
ALTER TABLE maintenance_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE request_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_order_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE request_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE llm_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE policy_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE policy_chunks ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'properties','units','residents','leases','vendors','maintenance_requests',
    'request_messages','work_orders','work_order_events','request_audit_log',
    'llm_runs','policy_documents','policy_chunks'
  ]
  LOOP
    EXECUTE format(
      'CREATE POLICY tenant_scope ON %I USING (tenant_id = current_setting(''app.tenant_id'', true)::uuid) WITH CHECK (tenant_id = current_setting(''app.tenant_id'', true)::uuid)',
      t
    );
  END LOOP;
END $$;

CREATE POLICY tenant_scope ON tenants
  USING (id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY users_self ON users
  USING (id = current_setting('app.user_id', true)::uuid)
  WITH CHECK (id = current_setting('app.user_id', true)::uuid);

CREATE POLICY users_tenant_visible ON users
  USING (EXISTS (
    SELECT 1 FROM tenant_memberships m
    WHERE m.user_id = users.id
      AND m.tenant_id = current_setting('app.tenant_id', true)::uuid
  ));

CREATE POLICY membership_scope ON tenant_memberships
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- Grants (skip on hosted Postgres where custom roles may not exist) ------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pmagent_api') THEN
    GRANT USAGE ON SCHEMA public TO pmagent_api, pmagent_worker;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO pmagent_api, pmagent_worker;
    ALTER DEFAULT PRIVILEGES FOR ROLE pmagent IN SCHEMA public
      GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO pmagent_api, pmagent_worker;
  END IF;
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'Skipping grants (hosted Postgres) — using default role';
END $$;
