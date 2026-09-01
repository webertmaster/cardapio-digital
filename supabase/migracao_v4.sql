-- ============================================================
-- MIGRAÇÃO V4 — entrega por raio de distância (estilo iFood)
-- Rode este arquivo no SQL Editor do Supabase depois da migracao_v3.sql
--
-- Isso substitui o sistema de taxa por bairro (tabela `taxas_entrega`)
-- por faixas de raio em km, calculadas a partir da localização real da
-- loja e do pin que o cliente marca no mapa no checkout. A tabela
-- `taxas_entrega` antiga NÃO é apagada (fica órfã, sem uso) — só não é
-- mais referenciada pelo painel nem pelo cardápio do cliente.
-- ============================================================

-- 1. Localização da loja (centro dos círculos de raio)
alter table estabelecimentos add column if not exists latitude numeric(10,7);
alter table estabelecimentos add column if not exists longitude numeric(10,7);

-- 2. Localização do endereço de entrega (pin que o cliente marca)
alter table enderecos add column if not exists latitude numeric(10,7);
alter table enderecos add column if not exists longitude numeric(10,7);

-- 3. Faixas de raio de entrega
create table if not exists raios_entrega (
  id uuid primary key default gen_random_uuid(),
  estabelecimento_id uuid not null references estabelecimentos(id) on delete cascade,
  raio_km numeric(4,2) not null,   -- raio externo da faixa: 0.5, 1, 1.5, 2 ... 10
  valor numeric(10,2) not null,    -- 0 = grátis
  ativa boolean not null default true
);

alter table raios_entrega enable row level security;

create policy "publico le raios" on raios_entrega for select using (ativa = true);

create policy "loja gerencia raios" on raios_entrega for all
  using (estabelecimento_id in (select estabelecimento_id from usuarios where id = auth.uid()));
