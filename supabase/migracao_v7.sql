-- ============================================================
-- MIGRAÇÃO V7 — categorias de ingredientes com limite de escolha
-- (ex: "Proteínas" — escolha até 2; "Salada" — escolha até 3)
-- Rode este arquivo no SQL Editor do Supabase depois da migracao_v6.sql
-- ============================================================

-- 1. Grupo/categoria de ingredientes, por produto
create table if not exists grupos_ingredientes (
  id uuid primary key default gen_random_uuid(),
  produto_id uuid not null references produtos(id) on delete cascade,
  nome text not null,             -- ex: "Proteínas", "Salada"
  limite_escolha int,             -- null = sem limite; N = escolher até N
  ordem int not null default 0,
  ativo boolean not null default true
);

alter table grupos_ingredientes enable row level security;

create policy "publico le grupos ingredientes" on grupos_ingredientes for select using (ativo = true);

create policy "loja gerencia grupos ingredientes" on grupos_ingredientes for all
  using (produto_id in (select id from produtos where estabelecimento_id in
    (select estabelecimento_id from usuarios where id = auth.uid())));

-- 2. Ingredientes passam a pertencer a um GRUPO (não direto ao produto).
--    Se você já tinha ingredientes cadastrados (da migracao_v6), esse
--    bloco cria automaticamente um grupo "Ingredientes" sem limite pra
--    cada produto e migra o que já existia pra dentro dele, sem perder
--    nada.
alter table ingredientes add column if not exists grupo_id uuid references grupos_ingredientes(id) on delete cascade;

do $$
begin
  if exists (select 1 from information_schema.columns where table_name = 'ingredientes' and column_name = 'produto_id') then
    insert into grupos_ingredientes (produto_id, nome, limite_escolha, ordem)
    select distinct produto_id, 'Ingredientes', null::int, 0
    from ingredientes
    where produto_id is not null
      and not exists (select 1 from grupos_ingredientes g where g.produto_id = ingredientes.produto_id);

    update ingredientes i
    set grupo_id = g.id
    from grupos_ingredientes g
    where g.produto_id = i.produto_id and i.grupo_id is null;
  end if;
end $$;

-- Recria a política sempre (fora do bloco acima) pra rodar sem erro
-- mesmo que esse arquivo seja executado mais de uma vez.
drop policy if exists "loja gerencia ingredientes" on ingredientes;
alter table ingredientes drop column if exists produto_id;

create policy "loja gerencia ingredientes" on ingredientes for all
  using (grupo_id in (select id from grupos_ingredientes where produto_id in
    (select id from produtos where estabelecimento_id in
      (select estabelecimento_id from usuarios where id = auth.uid()))));
