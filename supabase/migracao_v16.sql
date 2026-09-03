-- ============================================================
-- MIGRAÇÃO V16 — cupons de desconto
-- Rode este arquivo no SQL Editor do Supabase depois da migracao_v15.sql
-- ============================================================
-- (horarios_funcionamento já existe desde o schema original — só faltava
-- a loja usar. Essa migração cuida só da parte nova: cupons.)

create table if not exists cupons (
  id uuid primary key default gen_random_uuid(),
  estabelecimento_id uuid not null references estabelecimentos(id) on delete cascade,
  codigo text not null,
  tipo text not null check (tipo in ('percentual', 'fixo')),
  valor numeric(10,2) not null,
  pedido_minimo numeric(10,2),
  validade date,
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  unique (estabelecimento_id, codigo)
);

alter table cupons enable row level security;

-- Igual categorias/produtos/taxas_entrega: só o que está ativo é público.
create policy "publico le cupons ativos" on cupons for select using (ativo = true);
create policy "loja gerencia cupons" on cupons for all
  using (estabelecimento_id in (select estabelecimento_id from usuario_lojas where id_usuario = auth.uid()));

alter table pedidos add column if not exists cupom_codigo text;
alter table pedidos add column if not exists desconto numeric(10,2) not null default 0;
