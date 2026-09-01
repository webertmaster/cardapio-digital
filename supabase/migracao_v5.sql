-- ============================================================
-- MIGRAÇÃO V5 — pagamento com cartão (na entrega) + entregadores
-- com rastreamento em tempo real
-- Rode este arquivo no SQL Editor do Supabase depois da migracao_v4.sql
-- ============================================================

-- 1. Cartão na entrega — a loja liga/desliga se aceita ou não
alter table estabelecimentos add column if not exists aceita_cartao boolean not null default false;

alter table pedidos drop constraint if exists pedidos_forma_pagamento_check;
alter table pedidos add constraint pedidos_forma_pagamento_check
  check (forma_pagamento in ('pix', 'dinheiro', 'cartao'));

-- ============================================================
-- 2. ENTREGADORES
-- ============================================================
-- Tabela PRIVADA (nome, telefone, PIN) — só a loja enxerga, via RLS.
-- O app do entregador nunca faz select direto aqui: ele passa pelo
-- PIN nas funções abaixo (security definer), que validam por dentro.
create table if not exists entregadores (
  id uuid primary key default gen_random_uuid(),
  estabelecimento_id uuid not null references estabelecimentos(id) on delete cascade,
  nome text not null,
  telefone text,
  pin text not null,
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  unique (estabelecimento_id, pin)
);

alter table entregadores enable row level security;

create policy "loja gerencia entregadores" on entregadores for all
  using (estabelecimento_id in (select estabelecimento_id from usuarios where id = auth.uid()));

-- View pública SÓ com id+nome — pro cliente mostrar "seu entregador é
-- Fulano" na tela de acompanhamento, sem expor telefone nem PIN.
create or replace view entregador_publico as
  select id, nome from entregadores;
grant select on entregador_publico to anon;

-- Tabela PÚBLICA separada só com a localização (nada sensível aqui),
-- assim dá pra habilitar Realtime nela sem risco de vazar PIN/telefone.
create table if not exists entregador_localizacao (
  entregador_id uuid primary key references entregadores(id) on delete cascade,
  latitude numeric(10,7),
  longitude numeric(10,7),
  atualizado_em timestamptz
);

alter table entregador_localizacao enable row level security;
create policy "publico le localizacao entregador" on entregador_localizacao for select using (true);
alter publication supabase_realtime add table entregador_localizacao;

-- 3. Qual entregador está com o pedido
alter table pedidos add column if not exists entregador_id uuid references entregadores(id);

-- ============================================================
-- 4. FUNÇÕES DO APP DO ENTREGADOR (login por PIN, sem Supabase Auth)
-- ============================================================
create or replace function entregador_login(p_slug text, p_pin text)
returns table(entregador_id uuid, nome text, estabelecimento_id uuid, estabelecimento_nome text)
language plpgsql security definer set search_path = public as $$
begin
  return query
    select e.id, e.nome, e.estabelecimento_id, est.nome
    from entregadores e
    join estabelecimentos est on est.id = e.estabelecimento_id
    where est.slug = p_slug and e.pin = p_pin and e.ativo = true;
end;
$$;
grant execute on function entregador_login(text, text) to anon;

create or replace function entregador_atualizar_localizacao(p_entregador_id uuid, p_pin text, p_lat numeric, p_lng numeric)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from entregadores where id = p_entregador_id and pin = p_pin and ativo = true) then
    raise exception 'Acesso inválido';
  end if;
  insert into entregador_localizacao (entregador_id, latitude, longitude, atualizado_em)
  values (p_entregador_id, p_lat, p_lng, now())
  on conflict (entregador_id) do update
    set latitude = excluded.latitude, longitude = excluded.longitude, atualizado_em = excluded.atualizado_em;
end;
$$;
grant execute on function entregador_atualizar_localizacao(uuid, text, numeric, numeric) to anon;

create or replace function entregador_marcar_entregue(p_pedido_id uuid, p_entregador_id uuid, p_pin text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from entregadores where id = p_entregador_id and pin = p_pin and ativo = true) then
    raise exception 'Acesso inválido';
  end if;
  update pedidos set status = 'entregue', atualizado_em = now()
  where id = p_pedido_id and entregador_id = p_entregador_id;
end;
$$;
grant execute on function entregador_marcar_entregue(uuid, uuid, text) to anon;
