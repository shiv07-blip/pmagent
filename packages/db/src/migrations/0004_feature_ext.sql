-- 0004_feature_ext.sql
-- Vendor auto-dispatch, CSAT, stalled-ticket recovery, LLM budget alerting.

-- Vendor dispatch: token-scoped accept/decline links on assigned work orders
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS dispatch_token text;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS dispatched_at timestamptz;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS vendor_response text;
CREATE INDEX IF NOT EXISTS work_orders_dispatch_token_idx
  ON work_orders (dispatch_token) WHERE dispatch_token IS NOT NULL;

-- CSAT: resident satisfaction survey after completion
ALTER TABLE maintenance_requests ADD COLUMN IF NOT EXISTS csat_score smallint;
ALTER TABLE maintenance_requests ADD COLUMN IF NOT EXISTS csat_asked_at timestamptz;

-- Stalled-ticket recovery: nudge ladder tracking
ALTER TABLE maintenance_requests ADD COLUMN IF NOT EXISTS stalled_count integer NOT NULL DEFAULT 0;
ALTER TABLE maintenance_requests ADD COLUMN IF NOT EXISTS last_stalled_check timestamptz;
CREATE INDEX IF NOT EXISTS requests_stalled_idx
  ON maintenance_requests (status, updated_at) WHERE status = 'awaiting_info';

-- LLM budget alert once per month per tenant
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS llm_budget_alert_sent boolean NOT NULL DEFAULT false;

-- CSAT recording action
DO $$
BEGIN
  ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'csat';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;