-- 0003_add_telegram_source.sql — add telegram to ticket_source enum
ALTER TYPE ticket_source ADD VALUE IF NOT EXISTS 'telegram';
