import { loadRootEnv } from '@pma/core';
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
        "channels": [{"channel":"sms","from":"+15551230000","enabled":true}]
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

      -- Policy doc placeholder (no embeddings yet) ------------------------------
      INSERT INTO policy_documents (tenant_id, name, doc_type, status)
      VALUES (v_tenant, 'Maintenance Policy', 'policy', 'ready');
      INSERT INTO policy_chunks (tenant_id, document_id, chunk_index, content, embedding)
      VALUES (v_tenant, (SELECT id FROM policy_documents WHERE tenant_id = v_tenant LIMIT 1), 0,
              'Tenants are responsible for clogged drains caused by misuse, replacing light bulbs, and damage from appliance misuse. The landlord maintains structural systems, plumbing leaks, HVAC, and appliances in working order.',
              (array_fill(0, ARRAY[1536])::float[])::vector);
    END IF;
  END $$;
  `;

  await withServiceClient(async (client) => {
    await client.query(seedSql);
  });
  console.log('[seed] done — tenant=acme-pm, admin=admin@acme.example/admin123');
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  seed().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
