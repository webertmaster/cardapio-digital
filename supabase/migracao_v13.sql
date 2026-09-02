-- ============================================================
-- MIGRAÇÃO V13 — foto opcional por ingrediente
-- Rode este arquivo no SQL Editor do Supabase depois da migracao_v12.sql
-- ============================================================

alter table ingredientes add column if not exists foto_url text;
