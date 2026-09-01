-- ============================================================
-- MIGRAÇÃO V10 — corrige o valor padrão de disponibilidade
-- Rode este arquivo no SQL Editor do Supabase depois da migracao_v9.sql
-- ============================================================

-- A v9 deixou "disponivel" com padrão true, então todo entregador
-- cadastrado aparecia como "Disponível" no painel mesmo sem nunca ter
-- aberto o app dele (e por isso sem localização real no mapa). O certo é
-- começar OFF: o entregador liga a disponibilidade dele mesmo, ao entrar
-- no app, igual iFood/Uber.
alter table entregadores alter column disponivel set default false;
update entregadores set disponivel = false;
