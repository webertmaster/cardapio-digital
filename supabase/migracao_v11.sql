-- ============================================================
-- MIGRAÇÃO V11 — armazenamento seguro da chave do iFood (Fase 1)
-- Rode este arquivo no SQL Editor do Supabase depois da migracao_v10.sql
-- ============================================================

-- Guarda o client_id/client_secret de cada loja pra integração com o
-- iFood. Só o dono da loja (autenticado) enxerga a própria linha — sem
-- nenhuma policy de anon, ao contrário de outras tabelas públicas do
-- projeto. A autorização de fato com o iFood e a busca de pedidos ainda
-- não estão implementadas — por enquanto isso só guarda a chave com
-- segurança.
create table if not exists ifood_credenciais (
  id uuid primary key default gen_random_uuid(),
  estabelecimento_id uuid not null unique references estabelecimentos(id) on delete cascade,
  client_id text not null,
  client_secret text not null,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

alter table ifood_credenciais enable row level security;

create policy "loja gerencia credenciais ifood" on ifood_credenciais for all
  using (estabelecimento_id in (select estabelecimento_id from usuarios where id = auth.uid()));
