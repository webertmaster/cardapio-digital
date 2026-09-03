-- ============================================================
-- MIGRAÇÃO V17 — índice pra busca por pedido do iFood
-- Rode este arquivo no SQL Editor do Supabase depois da migracao_v16.sql
-- ============================================================

create index if not exists idx_pedidos_ifood_order_id on pedidos(ifood_order_id) where ifood_order_id is not null;
