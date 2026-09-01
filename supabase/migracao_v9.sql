-- ============================================================
-- MIGRAÇÃO V9 — entregador liga/desliga a própria disponibilidade
-- Rode este arquivo no SQL Editor do Supabase depois da migracao_v8.sql
-- ============================================================

-- Disponibilidade é diferente de "ativo": "ativo" é a loja habilitando ou
-- desligando o cadastro do entregador; "disponivel" é o próprio entregador
-- avisando que está de plantão, no próprio app dele.
alter table entregadores add column if not exists disponivel boolean not null default true;

-- O login precisa devolver a disponibilidade atual, pra já abrir o app
-- do jeito que o entregador deixou da última vez. Muda o tipo de retorno,
-- então precisa dropar antes de recriar.
drop function if exists entregador_login(text, text);
create function entregador_login(p_slug text, p_pin text)
returns table(entregador_id uuid, nome text, estabelecimento_id uuid, estabelecimento_nome text, disponivel boolean)
language plpgsql security definer set search_path = public as $$
begin
  return query
    select e.id, e.nome, e.estabelecimento_id, est.nome, e.disponivel
    from entregadores e
    join estabelecimentos est on est.id = e.estabelecimento_id
    where est.slug = p_slug and e.pin = p_pin and e.ativo = true;
end;
$$;
grant execute on function entregador_login(text, text) to anon;

-- Liga/desliga a disponibilidade. Ao desligar, apaga a localização na hora
-- (pra sumir do mapa imediatamente); ao ligar, volta a aparecer assim que
-- o app enviar a próxima localização.
create or replace function entregador_definir_disponibilidade(p_entregador_id uuid, p_pin text, p_disponivel boolean)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from entregadores where id = p_entregador_id and pin = p_pin and ativo = true) then
    raise exception 'Acesso inválido';
  end if;
  update entregadores set disponivel = p_disponivel where id = p_entregador_id;
  if not p_disponivel then
    delete from entregador_localizacao where entregador_id = p_entregador_id;
  end if;
end;
$$;
grant execute on function entregador_definir_disponibilidade(uuid, text, boolean) to anon;
