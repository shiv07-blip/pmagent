import { loadRootEnv, embeddingLiteral } from '@pma/core';
import { withServiceClient } from './db.js';
import { migrate } from './migrate.js';

loadRootEnv();

/**
 * Seeds a demo tenant with realistic data so you can exercise the whole flow:
 *   tenant:    acme-pm (slug)
 *   admin:     admin@acme.example / admin123
 *   2 properties, 3 units, 2 residents (with SMS-ready phone numbers),
 *   a small vendor pool across the main trades, and one policy doc.
 */
export async function seed(): Promise<void> {
  await migrate();

  const policyText =
    'Tenants are responsible for clogged drains caused by misuse, replacing light bulbs, and damage from appliance misuse. The landlord maintains structural systems, plumbing leaks, HVAC, and appliances in working order.';

  const seedSql = `
  DO $$
  DECLARE
    v_tenant uuid;
    v_user uuid;
    v_prop_a uuid;
    v_prop_b uuid;
    v_unit_1 uuid;
    v_unit_2 uuid;
    v_unit_3 uuid;
    v_res_1 uuid;
    v_res_2 uuid;
    v_plumber uuid;
    v_hvac uuid;
    v_electrician uuid;
  BEGIN
    -- Tenant + user ----------------------------------------------------------
    IF NOT EXISTS (SELECT 1 FROM tenants WHERE slug = 'acme-pm') THEN
      INSERT INTO tenants (name, slug, config)
      VALUES ('Acme Property Management', 'acme-pm', '{
        "ownerApprovalThresholdUsd": 500,
        "supportedTrades": ["plumbing","hvac","electrical","appliance","structural","pest","lock","common","other"],
        "preferredVendorIds": [],
        "ackSlaMinutes": 60,
        "emergencyKeywords": ["gas leak","burst pipe","no heat","flooding","smoke","fire","electrical fire","no hot water"],
        "channels": [{"channel":"sms","from":"+15551230000","enabled":true}],
        "oncall": {"phone":"+12225550100","email":"oncall@acme.example"}
      }'::jsonb)
      RETURNING id INTO v_tenant;

      INSERT INTO users (email, password_hash, name, timezone)
      VALUES ('admin@acme.example', 'scrypt$d1ced7de1d2feb463bc376e81762e491$373faa3f90f842c74b1aec780568d4634542e380f1c7a7176c3fcb6cfc78c76d1c08460ebbcf5a6ac46ec48c9754a67a0011445e893cee772598a58e6d705a65', 'Alice Admin', 'America/New_York')
      RETURNING id INTO v_user;

      INSERT INTO tenant_memberships (tenant_id, user_id, role) VALUES (v_tenant, v_user, 'owner');

      -- Properties / units ----------------------------------------------------
      INSERT INTO properties (tenant_id, name, address, timezone)
      VALUES (v_tenant, 'Maple Court Apartments', '{"street":"1200 Maple St","city":"Springfield","state":"IL","zip":"62704"}', 'America/Chicago')
      RETURNING id INTO v_prop_a;

      INSERT INTO properties (tenant_id, name, address, timezone)
      VALUES (v_tenant, 'Oak Ridge Townhomes', '{"street":"88 Oak Ridge Rd","city":"Springfield","state":"IL","zip":"62702"}', 'America/Chicago')
      RETURNING id INTO v_prop_b;

      INSERT INTO units (tenant_id, property_id, unit_number, bedrooms, bathrooms, monthly_rent_cents, status)
      VALUES (v_tenant, v_prop_a, '101', 1, 1, 110000, 'occupied') RETURNING id INTO v_unit_1;
      INSERT INTO units (tenant_id, property_id, unit_number, bedrooms, bathrooms, monthly_rent_cents, status)
      VALUES (v_tenant, v_prop_a, '102', 2, 1, 145000, 'occupied') RETURNING id INTO v_unit_2;
      INSERT INTO units (tenant_id, property_id, unit_number, bedrooms, bathrooms, monthly_rent_cents, status)
      VALUES (v_tenant, v_prop_b, '3B', 3, 2, 210000, 'occupied') RETURNING id INTO v_unit_3;

      -- Residents + leases -----------------------------------------------------
      INSERT INTO residents (tenant_id, name, email, phone)
      VALUES (v_tenant, 'Jamie Rivera', 'jamie.rivera@example.com', '+12025550101') RETURNING id INTO v_res_1;
      INSERT INTO residents (tenant_id, name, email, phone)
      VALUES (v_tenant, 'Sam Whitfield', 'sam.whitfield@example.com', '+12025550102') RETURNING id INTO v_res_2;

      INSERT INTO leases (tenant_id, unit_id, resident_id, start_date, end_date, deposit_cents, monthly_rent_cents, status, terms)
      VALUES (v_tenant, v_unit_1, v_res_1, now() - interval '8 months', now() + interval '4 months', 110000, 110000, 'active',
              '{"tenantResponsible":["clogged drains from misuse","replacement of bulbs","appliance misuse damage"],"landlordResponsible":["structural","plumbing leaks","hvac systems","appliances in working order"]}'::jsonb);
      INSERT INTO leases (tenant_id, unit_id, resident_id, start_date, end_date, deposit_cents, monthly_rent_cents, status, terms)
      VALUES (v_tenant, v_unit_2, v_res_2, now() - interval '1 year', now() + interval '8 months', 145000, 145000, 'active', '{}'::jsonb);

      -- Vendors ----------------------------------------------------------------
      INSERT INTO vendors (tenant_id, name, trades, service_areas, phone, email, hourly_rate_cents, emergency_capable, is_preferred)
      VALUES (v_tenant, 'Flowstate Plumbing', ARRAY['plumbing']::trade[], '{"zips":["62704","62702"]}', '+12175550101', 'dispatch@flowstate.example', 12500, true, true)
      RETURNING id INTO v_plumber;
      INSERT INTO vendors (tenant_id, name, trades, service_areas, phone, email, hourly_rate_cents, emergency_capable, is_preferred)
      VALUES (v_tenant, 'Arctic & Aura HVAC', ARRAY['hvac']::trade[], '{"zips":["62704","62702","62703"]}', '+12175550102', 'jobs@arcticaura.example', 14000, true, true)
      RETURNING id INTO v_hvac;
      INSERT INTO vendors (tenant_id, name, trades, service_areas, phone, email, hourly_rate_cents, emergency_capable, is_preferred)
      VALUES (v_tenant, 'Shockproof Electric', ARRAY['electrical']::trade[], '{"zips":["62704","62702"]}', '+12175550103', 'hello@shockproof.example', 15000, true, false)
      RETURNING id INTO v_electrician;

      -- Policy doc with real (deterministic) embeddings -----------------------
      INSERT INTO policy_documents (tenant_id, name, doc_type, status)
      VALUES (v_tenant, 'Maintenance Policy', 'policy', 'ready');
      INSERT INTO policy_chunks (tenant_id, document_id, chunk_index, content, embedding)
      VALUES (v_tenant, (SELECT id FROM policy_documents WHERE tenant_id = v_tenant LIMIT 1), 0,
              '${policyText.replace(/'/g, "''")}',
              ${embeddingLiteral(policyText)}::vector);
    END IF;
  END $$;
  `;

  const demoWorkloadSql = `
  DO $$
  DECLARE
    v_tenant uuid;
    v_req_new uuid;
    v_req_triage uuid;
    v_req_info uuid;
    v_req_wo uuid;
    v_req_prog uuid;
    v_req_escal uuid;
    v_req_done1 uuid;
    v_req_done2 uuid;
    v_req_closed uuid;
    v_req_cancel uuid;
  BEGIN
    SELECT id INTO v_tenant FROM tenants WHERE slug = 'acme-pm';

    -- Only populate the demo workload once: if requests already exist for the
    -- tenant, the dashboard already has data (keep it idempotent on redeploys).
    IF v_tenant IS NULL OR EXISTS (SELECT 1 FROM maintenance_requests WHERE tenant_id = v_tenant) THEN
      RETURN;
    END IF;

    -- Requests across all lifecycle statuses -------------------------------
    INSERT INTO maintenance_requests (tenant_id, unit_id, resident_id, source, body, status, urgency, category, confidence, summary, first_ack_at, csat_score, created_at)
    VALUES (v_tenant, (SELECT id FROM units WHERE tenant_id = v_tenant AND unit_number = '101'), (SELECT id FROM residents WHERE tenant_id = v_tenant AND phone = '+12025550101'), 'sms',
            'Water is leaking under the kitchen sink and the cabinet bottom is starting to warp.', 'new', 'routine', 'plumbing', 0.94, 'Slow leak under kitchen sink',
            NULL, NULL, now() - interval '3 days')
    RETURNING id INTO v_req_new;

    INSERT INTO maintenance_requests (tenant_id, unit_id, resident_id, source, body, status, urgency, category, confidence, summary, first_ack_at, csat_score, created_at)
    VALUES (v_tenant, (SELECT id FROM units WHERE tenant_id = v_tenant AND unit_number = '102'), (SELECT id FROM residents WHERE tenant_id = v_tenant AND phone = '+12025550102'), 'sms',
            'AC unit stopped cooling, indoor temperature is 84 and climbing.', 'triaging', 'urgent', 'hvac', 0.88, 'AC not cooling',
            now() - interval '23 hours', NULL, now() - interval '1 day 4 hours')
    RETURNING id INTO v_req_triage;

    INSERT INTO maintenance_requests (tenant_id, unit_id, resident_id, source, body, status, urgency, category, confidence, summary, first_ack_at, csat_score, created_at)
    VALUES (v_tenant, (SELECT id FROM units WHERE tenant_id = v_tenant AND unit_number = '101'), (SELECT id FROM residents WHERE tenant_id = v_tenant AND phone = '+12025550101'), 'sms',
            'Dishwasher is not draining, there is standing water at the bottom.', 'awaiting_info', 'routine', 'appliance', 0.80, 'Dishwasher not draining',
            now() - interval '2 days 2 hours', NULL, now() - interval '2 days')
    RETURNING id INTO v_req_info;

    INSERT INTO maintenance_requests (tenant_id, unit_id, resident_id, source, body, status, urgency, category, confidence, summary, first_ack_at, csat_score, created_at)
    VALUES (v_tenant, (SELECT id FROM units WHERE tenant_id = v_tenant AND unit_number = '101'), (SELECT id FROM residents WHERE tenant_id = v_tenant AND phone = '+12025550101'), 'sms',
            'Pipe burst under the bathroom sink, I shut off the water valve.', 'work_order_created', 'emergency', 'plumbing', 0.97, 'Burst pipe - water shut off',
            now() - interval '4 hours 30 minutes', NULL, now() - interval '5 hours')
    RETURNING id INTO v_req_wo;

    INSERT INTO maintenance_requests (tenant_id, unit_id, resident_id, source, body, status, urgency, category, confidence, summary, first_ack_at, csat_score, created_at)
    VALUES (v_tenant, (SELECT id FROM units WHERE tenant_id = v_tenant AND unit_number = '3B'), (SELECT id FROM residents WHERE tenant_id = v_tenant AND phone = '+12025550102'), 'sms',
            'Outlet in the bedroom smells like burning plastic when in use.', 'in_progress', 'urgent', 'electrical', 0.93, 'Outlet smells like burning plastic',
            now() - interval '1 day 9 hours', NULL, now() - interval '1 day 10 hours')
    RETURNING id INTO v_req_prog;

    INSERT INTO maintenance_requests (tenant_id, unit_id, resident_id, source, body, status, urgency, category, confidence, summary, first_ack_at, csat_score, created_at)
    VALUES (v_tenant, (SELECT id FROM units WHERE tenant_id = v_tenant AND unit_number = '3B'), (SELECT id FROM residents WHERE tenant_id = v_tenant AND phone = '+12025550102'), 'sms',
            'Crack in the living room ceiling is growing wider, pieces of paint are falling.', 'escalated', 'urgent', 'structural', 0.85, 'Growing ceiling crack',
            now() - interval '3 days 20 hours', NULL, now() - interval '4 days')
    RETURNING id INTO v_req_escal;

    INSERT INTO maintenance_requests (tenant_id, unit_id, resident_id, source, body, status, urgency, category, confidence, summary, first_ack_at, csat_score, created_at)
    VALUES (v_tenant, (SELECT id FROM units WHERE tenant_id = v_tenant AND unit_number = '102'), (SELECT id FROM residents WHERE tenant_id = v_tenant AND phone = '+12025550102'), 'sms',
            'Furnace makes a loud banging noise every time it cycles on.', 'completed', 'routine', 'hvac', 0.90, 'Furnace banging noise',
            now() - interval '19 days', 4, now() - interval '20 days')
    RETURNING id INTO v_req_done1;

    INSERT INTO maintenance_requests (tenant_id, unit_id, resident_id, source, body, status, urgency, category, confidence, summary, first_ack_at, csat_score, created_at)
    VALUES (v_tenant, (SELECT id FROM units WHERE tenant_id = v_tenant AND unit_number = '101'), (SELECT id FROM residents WHERE tenant_id = v_tenant AND phone = '+12025550101'), 'sms',
            'Ants are back in the kitchen around the sink area.', 'completed', 'routine', 'pest', 0.89, 'Kitchen ants',
            now() - interval '30 days', 5, now() - interval '31 days')
    RETURNING id INTO v_req_done2;

    INSERT INTO maintenance_requests (tenant_id, unit_id, resident_id, source, body, status, urgency, category, confidence, summary, first_ack_at, csat_score, created_at)
    VALUES (v_tenant, (SELECT id FROM units WHERE tenant_id = v_tenant AND unit_number = '102'), (SELECT id FROM residents WHERE tenant_id = v_tenant AND phone = '+12025550102'), 'sms',
            'Bathroom drain is clogged, looks like hair and grease buildup.', 'closed', 'tenant_responsible', 'plumbing', 0.78, 'Bathroom drain clogged',
            now() - interval '5 days 12 hours', 3, now() - interval '6 days')
    RETURNING id INTO v_req_closed;

    INSERT INTO maintenance_requests (tenant_id, unit_id, resident_id, source, body, status, urgency, category, confidence, summary, first_ack_at, csat_score, created_at)
    VALUES (v_tenant, (SELECT id FROM units WHERE tenant_id = v_tenant AND unit_number = '101'), (SELECT id FROM residents WHERE tenant_id = v_tenant AND phone = '+12025550101'), 'sms',
            'Dishwasher will not turn on at all, no lights on the panel. Resident fixed it themselves.', 'cancelled', 'routine', 'appliance', 0.82, 'Dishwasher dead',
            now() - interval '14 days', NULL, now() - interval '15 days')
    RETURNING id INTO v_req_cancel;

    -- Messages ---------------------------------------------------------------
    INSERT INTO request_messages (tenant_id, request_id, direction, channel, body, sender_type, sender_id, created_at)
    VALUES (v_tenant, v_req_wo, 'inbound', 'sms', 'Pipe burst under the bathroom sink, I shut off the water valve.', 'resident', (SELECT id FROM residents WHERE tenant_id = v_tenant AND phone = '+12025550101'), now() - interval '5 hours');
    INSERT INTO request_messages (tenant_id, request_id, direction, channel, body, sender_type, created_at)
    VALUES (v_tenant, v_req_wo, 'outbound', 'sms', 'Plumber is dispatched, ETA within 2 hours. Stay out of the bathroom until they arrive.', 'agent', now() - interval '4 hours 55 minutes');
    INSERT INTO request_messages (tenant_id, request_id, direction, channel, body, sender_type, sender_id, created_at)
    VALUES (v_tenant, v_req_triage, 'inbound', 'sms', 'AC unit stopped cooling, indoor temperature is 84 and climbing.', 'resident', (SELECT id FROM residents WHERE tenant_id = v_tenant AND phone = '+12025550102'), now() - interval '1 day 4 hours');
    INSERT INTO request_messages (tenant_id, request_id, direction, channel, body, sender_type, created_at)
    VALUES (v_tenant, v_req_triage, 'outbound', 'sms', 'Hi Sam, thanks for reporting this. An HVAC contractor will reach out shortly to schedule.', 'ai', now() - interval '1 day 3 hours');
    INSERT INTO request_messages (tenant_id, request_id, direction, channel, body, sender_type, created_at)
    VALUES (v_tenant, v_req_prog, 'outbound', 'sms', 'This was flagged urgent. An electrician has been assigned and will contact you.', 'ai', now() - interval '1 day 9 hours');
    INSERT INTO request_messages (tenant_id, request_id, direction, channel, body, sender_type, created_at)
    VALUES (v_tenant, v_req_done1, 'outbound', 'sms', 'Your service visit is complete. How satisfied were you with the repair? Reply 1, 2, 3, 4, or 5.', 'ai', now() - interval '12 days');
    INSERT INTO request_messages (tenant_id, request_id, direction, channel, body, sender_type, created_at)
    VALUES (v_tenant, v_req_closed, 'outbound', 'sms', 'Per your lease, tenant-caused clogs are your responsibility. We have sent drain care instructions.', 'agent', now() - interval '5 days');

    -- Work orders -------------------------------------------------------------
    INSERT INTO work_orders (tenant_id, request_id, vendor_id, status, est_cost_cents, notes, dispatch_token, dispatched_at, created_at)
    VALUES (v_tenant, v_req_wo, (SELECT id FROM vendors WHERE tenant_id = v_tenant AND name = 'Flowstate Plumbing'), 'assigned', 42500, 'Emergency burst pipe repair', 'seed-demo-plumb', now() - interval '4 hours 30 minutes', now() - interval '5 hours');
    INSERT INTO work_orders (tenant_id, request_id, vendor_id, status, est_cost_cents, notes, created_at)
    VALUES (v_tenant, v_req_prog, (SELECT id FROM vendors WHERE tenant_id = v_tenant AND name = 'Shockproof Electric'), 'in_progress', 18900, 'Replace bedroom outlet circuit', now() - interval '1 day');
    INSERT INTO work_orders (tenant_id, request_id, vendor_id, status, est_cost_cents, notes, created_at)
    VALUES (v_tenant, v_req_escal, NULL, 'proposed', 98500, 'Structural engineer review required - owner approval', now() - interval '3 days');
    INSERT INTO work_orders (tenant_id, request_id, vendor_id, status, est_cost_cents, actual_cost_cents, completed_at, created_at)
    VALUES (v_tenant, v_req_done1, (SELECT id FROM vendors WHERE tenant_id = v_tenant AND name = 'Arctic & Aura HVAC'), 'completed', 18500, 17650, now() - interval '12 days', now() - interval '19 days');
    INSERT INTO work_orders (tenant_id, request_id, vendor_id, status, est_cost_cents, actual_cost_cents, completed_at, created_at)
    VALUES (v_tenant, v_req_done2, NULL, 'completed', 12000, 11400, now() - interval '10 days', now() - interval '30 days');
    INSERT INTO work_orders (tenant_id, request_id, vendor_id, status, est_cost_cents, notes, created_at)
    VALUES (v_tenant, v_req_closed, (SELECT id FROM vendors WHERE tenant_id = v_tenant AND name = 'Flowstate Plumbing'), 'cancelled', 15000, 'Tenant responsible - no vendor visit needed', now() - interval '5 days');

    -- Audit trail (drives recent activity on the dashboard) -------------------
    INSERT INTO request_audit_log (tenant_id, request_id, action, actor_type, details, created_at)
    VALUES (v_tenant, v_req_wo, 'request_created', 'system', '{"source":"sms"}'::jsonb, now() - interval '5 hours');
    INSERT INTO request_audit_log (tenant_id, request_id, action, actor_type, details, created_at)
    VALUES (v_tenant, v_req_wo, 'classification', 'ai', '{"category":"plumbing","urgency":"emergency","confidence":0.97}'::jsonb, now() - interval '4 hours 58 minutes');
    INSERT INTO request_audit_log (tenant_id, request_id, action, actor_type, details, created_at)
    VALUES (v_tenant, v_req_wo, 'emergency_alert', 'system', '{"method":"sms","phone":"+12225550100"}'::jsonb, now() - interval '4 hours 57 minutes');
    INSERT INTO request_audit_log (tenant_id, request_id, action, actor_type, details, created_at)
    VALUES (v_tenant, v_req_wo, 'work_order_created', 'ai', '{"vendor":"Flowstate Plumbing","estCostCents":42500}'::jsonb, now() - interval '4 hours 55 minutes');
    INSERT INTO request_audit_log (tenant_id, request_id, action, actor_type, details, created_at)
    VALUES (v_tenant, v_req_wo, 'vendor_dispatch', 'system', '{"method":"sms","tokenIssued":true}'::jsonb, now() - interval '4 hours 50 minutes');
    INSERT INTO request_audit_log (tenant_id, request_id, action, actor_type, details, created_at)
    VALUES (v_tenant, v_req_new, 'request_created', 'system', '{"source":"sms"}'::jsonb, now() - interval '3 days');
    INSERT INTO request_audit_log (tenant_id, request_id, action, actor_type, details, created_at)
    VALUES (v_tenant, v_req_new, 'classification', 'ai', '{"category":"plumbing","urgency":"routine","confidence":0.94}'::jsonb, now() - interval '3 days');
    INSERT INTO request_audit_log (tenant_id, request_id, action, actor_type, details, created_at)
    VALUES (v_tenant, v_req_escal, 'request_created', 'system', '{"source":"sms"}'::jsonb, now() - interval '4 days');
    INSERT INTO request_audit_log (tenant_id, request_id, action, actor_type, details, created_at)
    VALUES (v_tenant, v_req_escal, 'escalation', 'system', '{"reason":"stalled_ack","hours":6}'::jsonb, now() - interval '3 days 18 hours');
    INSERT INTO request_audit_log (tenant_id, request_id, action, actor_type, details, created_at)
    VALUES (v_tenant, v_req_done1, 'work_order_status', 'agent', '{"from":"in_progress","to":"completed"}'::jsonb, now() - interval '12 days');
    INSERT INTO request_audit_log (tenant_id, request_id, action, actor_type, details, created_at)
    VALUES (v_tenant, v_req_done1, 'csat', 'resident', '{"score":4}'::jsonb, now() - interval '12 days');
    INSERT INTO request_audit_log (tenant_id, request_id, action, actor_type, details, created_at)
    VALUES (v_tenant, v_req_done2, 'csat', 'resident', '{"score":5}'::jsonb, now() - interval '10 days');
    INSERT INTO request_audit_log (tenant_id, request_id, action, actor_type, details, created_at)
    VALUES (v_tenant, v_req_closed, 'resolve_first_touch', 'ai', '{"category":"tenant_responsible","resolution":"tenant notice"}'::jsonb, now() - interval '5 days');
    INSERT INTO request_audit_log (tenant_id, request_id, action, actor_type, details, created_at)
    VALUES (v_tenant, v_req_closed, 'csat', 'resident', '{"score":3}'::jsonb, now() - interval '4 days');

    -- LLM usage (drives /api/metrics/usage) ----------------------------------
    INSERT INTO llm_runs (tenant_id, request_id, provider, model, prompt_tokens, completion_tokens, cost_usd, latency_ms, created_at)
    VALUES (v_tenant, v_req_wo, 'anthropic', 'claude-3-5-haiku-20241022', 842, 96, 0.002450, 740, now() - interval '2 hours');
    INSERT INTO llm_runs (tenant_id, request_id, provider, model, prompt_tokens, completion_tokens, cost_usd, latency_ms, created_at)
    VALUES (v_tenant, v_req_wo, 'anthropic', 'claude-3-5-haiku-20241022', 1204, 142, 0.003410, 980, now() - interval '5 hours');
    INSERT INTO llm_runs (tenant_id, request_id, provider, model, prompt_tokens, completion_tokens, cost_usd, latency_ms, created_at)
    VALUES (v_tenant, v_req_triage, 'openai', 'gpt-4o-mini', 1560, 210, 0.004120, 1640, now() - interval '1 day');
    INSERT INTO llm_runs (tenant_id, request_id, provider, model, prompt_tokens, completion_tokens, cost_usd, latency_ms, created_at)
    VALUES (v_tenant, v_req_prog, 'anthropic', 'claude-3-5-haiku-20241022', 990, 118, 0.002840, 860, now() - interval '1 day 8 hours');
    INSERT INTO llm_runs (tenant_id, request_id, provider, model, prompt_tokens, completion_tokens, cost_usd, latency_ms, created_at)
    VALUES (v_tenant, v_req_escal, 'openai', 'gpt-4o-mini', 1820, 256, 0.004890, 2120, now() - interval '3 days');
    INSERT INTO llm_runs (tenant_id, request_id, provider, model, prompt_tokens, completion_tokens, cost_usd, latency_ms, created_at)
    VALUES (v_tenant, v_req_new, 'mock', 'mock-claude', 420, 60, 0.000120, 410, now() - interval '3 days 2 hours');
    INSERT INTO llm_runs (tenant_id, request_id, provider, model, prompt_tokens, completion_tokens, cost_usd, latency_ms, created_at)
    VALUES (v_tenant, v_req_info, 'anthropic', 'claude-3-5-haiku-20241022', 1150, 134, 0.003120, 920, now() - interval '2 days');
    INSERT INTO llm_runs (tenant_id, request_id, provider, model, prompt_tokens, completion_tokens, cost_usd, latency_ms, created_at)
    VALUES (v_tenant, v_req_done1, 'openai', 'gpt-4o-mini', 1654, 243, 0.004560, 1870, now() - interval '12 days');
    INSERT INTO llm_runs (tenant_id, request_id, provider, model, prompt_tokens, completion_tokens, cost_usd, latency_ms, created_at)
    VALUES (v_tenant, v_req_done2, 'mock', 'mock-claude', 380, 55, 0.000110, 390, now() - interval '30 days');
    INSERT INTO llm_runs (tenant_id, request_id, provider, model, prompt_tokens, completion_tokens, cost_usd, latency_ms, created_at)
    VALUES (v_tenant, v_req_closed, 'openai', 'gpt-4o-mini', 1420, 187, 0.003870, 1520, now() - interval '6 days');
    INSERT INTO llm_runs (tenant_id, request_id, provider, model, prompt_tokens, completion_tokens, cost_usd, latency_ms, created_at)
    VALUES (v_tenant, v_req_cancel, 'anthropic', 'claude-3-5-haiku-20241022', 861, 92, 0.002370, 700, now() - interval '15 days');
    INSERT INTO llm_runs (tenant_id, request_id, provider, model, prompt_tokens, completion_tokens, cost_usd, latency_ms, created_at)
    VALUES (v_tenant, v_req_closed, 'openai', 'gpt-4o-mini', 1310, 165, 0.003520, 1390, now() - interval '2 months');
  END $$;
  `;

  await withServiceClient(async (client) => {
    await client.query(seedSql);
    await client.query(demoWorkloadSql);
  });
  console.log('[seed] done — tenant=acme-pm, admin=admin@acme.example/admin123 (demo workload seeded on fresh db)');
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  seed().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
