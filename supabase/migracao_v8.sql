-- ============================================================
-- MIGRAÇÃO V8 — tipo de veículo do entregador (moto ou bicicleta)
-- Rode este arquivo no SQL Editor do Supabase depois da migracao_v7.sql
-- ============================================================

alter table entregadores add column if not exists veiculo text not null default 'moto'
  check (veiculo in ('moto', 'bicicleta'));

-- Atualiza a view pública pra também expor o veículo — o cardápio do
-- cliente precisa saber qual ícone mostrar no mapa de acompanhamento.
create or replace view entregador_publico as
  select id, nome, veiculo from entregadores;
