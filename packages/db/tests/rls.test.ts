import { describe, expect, it, beforeAll } from 'vitest';

/**
 * RLS isolation integration test. Requires a real Postgres:
 *   RUN_INTEGRATION=1 npm --workspace @pma/db test
 *
 * The API pool (API_DATABASE_URL) connects as a role subject to RLS
 * (pmagent_api in docker); each `withTenant` transaction scopes reads to that
 * tenant via `app.tenant_id`. Service-role (BYPASSRLS) writes seed tenant B.
 */

const runIntegration = process.env.RUN_INTEGRATION === '1';

describe.skipIf(!runIntegration)('RLS tenant isolation', () => {
  beforeAll(async () => {
    const { loadRootEnv } = await import('@pma/core');
    loadRootEnv();
    const { migrate } = await import('../src/migrate.js');
    await migrate();
  });

  it('tenant B is fully invisible to tenant A and vice versa', async () => {
    const d = await import('@pma/db');
    const w = d.workerDb();

    const [tenantA] = await w
      .select()
      .from(d.tenants)
      .where((await import('drizzle-orm')).sql`slug = 'acme-pm'`);
    expect(tenantA, 'seed() must have created tenant acme-pm').toBeDefined();

    const slug = `iso-test-${Date.now()}`;
    const [b] = await w.insert(d.tenants).values({ name: 'Isolation Test Co', slug }).returning();
    const [prop] = await w
      .insert(d.properties)
      .values({ tenantId: b!.id, name: 'Isolation Building', address: {}, timezone: 'UTC' })
      .returning();
    const [unitB] = await w
      .insert(d.units)
      .values({ tenantId: b!.id, propertyId: prop!.id, unitNumber: '1', monthlyRentCents: 100000, status: 'occupied' })
      .returning();
    const [resB] = await w
      .insert(d.residents)
      .values({ tenantId: b!.id, name: 'Maya Tenant', phone: '+12025550999' })
      .returning();
    await w.insert(d.maintenanceRequests).values({
      tenantId: b!.id,
      unitId: unitB!.id,
      residentId: resB!.id,
      source: 'sms',
      body: 'Tenant B secret request',
      status: 'new',
    });

    // As tenant B…
    const bRequests = await d.withTenant(b!.id, resB!.id, async (db) =>
      db.select({ tenantId: d.maintenanceRequests.tenantId }).from(d.maintenanceRequests),
    );
    expect(bRequests.map((r) => r.tenantId).every((t) => t === b!.id)).toBe(true);
    expect(bRequests.some((r) => r.tenantId === tenantA!.id)).toBe(false);

    // As tenant A…
    const aRequests = await d.withTenant(tenantA!.id, 'u-a', async (db) =>
      db.select({ tenantId: d.maintenanceRequests.tenantId }).from(d.maintenanceRequests),
    );
    expect(aRequests.some((r) => r.tenantId === b!.id)).toBe(false);

    // Service role sees both (proof the write went through, not RLS false-negative).
    const all = await w.select({ tenantId: d.maintenanceRequests.tenantId }).from(d.maintenanceRequests);
    expect(all.some((r) => r.tenantId === b!.id)).toBe(true);
  });
});