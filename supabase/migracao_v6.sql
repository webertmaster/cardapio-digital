-- ============================================================
-- MIGRAÇÃO V6 — ingredientes por produto, cor de destaque do
-- cardápio, e pagamento "no caixa/PDV"
-- Rode este arquivo no SQL Editor do Supabase depois da migracao_v5.sql
-- ============================================================

-- 1. Cor de destaque do cardápio do cliente (a loja escolhe entre
--    5 opções no painel). Guarda o valor hex direto.
alter table estabelecimentos add column if not exists cor_destaque text not null default '#FF5A36';

-- 2. Pagamento direto no caixa/PDV (pro cliente que retira o pedido)
alter table pedidos drop constraint if exists pedidos_forma_pagamento_check;
alter table pedidos add constraint pedidos_forma_pagamento_check
  check (forma_pagamento in ('pix', 'dinheiro', 'cartao', 'pdv'));

-- ============================================================
-- 3. INGREDIENTES — customização do prato (sem custo extra),
-- diferente de `adicionais` (que têm preço). Cada ingrediente já
-- vem marcado como incluído ou não por padrão; o cliente marca/
-- desmarca no cardápio.
-- ============================================================
create table if not exists ingredientes (
  id uuid primary key default gen_random_uuid(),
  produto_id uuid not null references produtos(id) on delete cascade,
  nome text not null,
  incluido_padrao boolean not null default true,
  ativo boolean not null default true,
  ordem int not null default 0
);

alter table ingredientes enable row level security;

create policy "publico le ingredientes" on ingredientes for select using (ativo = true);

create policy "loja gerencia ingredientes" on ingredientes for all
  using (produto_id in (select id from produtos where estabelecimento_id in
    (select estabelecimento_id from usuarios where id = auth.uid())));

-- Registra só o que o cliente MUDOU em relação ao padrão do produto
-- (ex: removeu o feijão branco, ou adicionou algo que não vinha
-- incluído) — igual o espírito do `item_adicionais` já existente.
create table if not exists item_pedido_ingredientes (
  id uuid primary key default gen_random_uuid(),
  item_pedido_id uuid not null references itens_pedido(id) on delete cascade,
  nome text not null,
  tipo text not null check (tipo in ('removido', 'adicionado'))
);

alter table item_pedido_ingredientes enable row level security;

create policy "qualquer um cria item ingrediente" on item_pedido_ingredientes for insert with check (true);
create policy "item ingrediente visivel" on item_pedido_ingredientes for select using (true);
