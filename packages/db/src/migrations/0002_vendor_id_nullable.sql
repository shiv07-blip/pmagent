-- 0002_vendor_id_nullable.sql — proposed work orders may not have a vendor yet
-- (owner-approval gate). vendor_id becomes nullable.
ALTER TABLE work_orders ALTER COLUMN vendor_id DROP NOT NULL;
