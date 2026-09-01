-- ============================================================
-- MIGRAÇÃO V2 — Upload de foto, Push notifications, Multi-loja
-- Rode este arquivo DEPOIS do schema.sql original
-- ============================================================

-- ------------------------------------------------------------
-- 1. UPLOAD DE FOTO — bucket de storage para fotos de produto
-- ------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('produtos', 'produtos', true)
on conflict (id) do nothing;

-- Qualquer um pode VER as fotos (o cardápio é público)
create policy "fotos de produto sao publicas"
on storage.objects for select
using (bucket_id = 'produtos');

-- Só usuários da loja autenticados podem enviar/trocar/apagar fotos,
-- e só dentro de uma pasta com o id do próprio estabelecimento
-- (ex: produtos/<estabelecimento_id>/arquivo.jpg)
create policy "loja envia fotos de produto"
on storage.objects for insert
with check (
  bucket_id = 'produtos'
  and (storage.foldername(name))[1] in (select estabelecimento_id::text from usuarios where id = auth.uid())
);

create policy "loja atualiza fotos de produto"
on storage.objects for update
using (
  bucket_id = 'produtos'
  and (storage.foldername(name))[1] in (select estabelecimento_id::text from usuarios where id = auth.uid())
);

create policy "loja apaga fotos de produto"
on storage.objects for delete
using (
  bucket_id = 'produtos'
  and (storage.foldername(name))[1] in (select estabelecimento_id::text from usuarios where id = auth.uid())
);

-- Logo do estabelecimento usa o mesmo bucket, pasta "logos/<estabelecimento_id>/..."
-- (as policies acima já cobrem, pois checam só o 1º nível de pasta = estabelecimento_id;
--  para a logo, ajuste o app para salvar em "<estabelecimento_id>/logo.jpg")


-- ------------------------------------------------------------
-- 2. PUSH NOTIFICATIONS — a tabela push_subscriptions já existe
--    (criada no schema.sql). Só precisamos permitir que a loja
--    LEIA as inscrições do seu estabelecimento, para poder
--    disparar os pushes pela Edge Function.
-- ------------------------------------------------------------
create policy "loja le push subscriptions"
on push_subscriptions for select
using (estabelecimento_id in (select estabelecimento_id from usuarios where id = auth.uid()));

-- Função utilitária: registra uma notificação toda vez que o
-- status de um pedido muda, para a Edge Function processar e
-- disparar o push (ela varre a tabela `notificacoes` com lida=false)
create or replace function registrar_notificacao_status()
returns trigger as $$
declare
  titulo text;
  corpo text;
begin
  if new.status = old.status then
    return new;
  end if;

  case new.status
    when 'aceito' then
      titulo := 'Pedido aceito!';
      corpo := 'Já começamos a preparar seu pedido #' || new.numero || '.';
    when 'preparando' then
      titulo := 'Preparando!';
      corpo := 'Seu pedido #' || new.numero || ' já está na cozinha.';
    when 'saiu_entrega' then
      titulo := 'Saiu para entrega!';
      corpo := 'Seu pedido #' || new.numero || ' está a caminho.';
    when 'entregue' then
      titulo := 'Pedido entregue';
      corpo := 'Bom apetite! Pedido #' || new.numero || ' foi entregue.';
    else
      return new;
  end case;

  insert into notificacoes (estabelecimento_id, pedido_id, destino, titulo, corpo)
  values (new.estabelecimento_id, new.id, 'cliente', titulo, corpo);

  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_notificacao_status on pedidos;
create trigger trg_notificacao_status
after update on pedidos
for each row execute function registrar_notificacao_status();

-- Também notifica a LOJA quando um pedido novo chega
create or replace function registrar_notificacao_novo_pedido()
returns trigger as $$
begin
  insert into notificacoes (estabelecimento_id, pedido_id, destino, titulo, corpo)
  values (new.estabelecimento_id, new.id, 'loja', 'Novo pedido', 'Pedido #' || new.numero || ' — ' || to_char(new.total, 'FM999999990.00'));
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_notificacao_novo_pedido on pedidos;
create trigger trg_notificacao_novo_pedido
after insert on pedidos
for each row execute function registrar_notificacao_novo_pedido();


-- ------------------------------------------------------------
-- 3. MULTI-LOJA — o mesmo usuário administrar mais de uma loja.
--    O schema já era multi-loja (tudo tem estabelecimento_id).
--    Em vez de alterar a tabela `usuarios` (que já tem FKs
--    apontando para ela, como push_subscriptions), criamos uma
--    tabela de vínculos separada: `usuario_lojas`.
--    A tabela `usuarios` original continua existindo e passa a
--    representar "a loja padrão / dados do usuário"; o painel
--    usa `usuario_lojas` para descobrir todas as lojas que essa
--    pessoa administra.
-- ------------------------------------------------------------
create table if not exists usuario_lojas (
  id_usuario uuid not null references auth.users(id) on delete cascade,
  estabelecimento_id uuid not null references estabelecimentos(id) on delete cascade,
  papel text not null default 'admin' check (papel in ('admin','operador')),
  primary key (id_usuario, estabelecimento_id)
);

-- Migra os vínculos que já existiam em `usuarios` para a nova tabela
insert into usuario_lojas (id_usuario, estabelecimento_id, papel)
select id, estabelecimento_id, papel from usuarios
on conflict do nothing;

alter table usuario_lojas enable row level security;
create policy "usuario le seus vinculos" on usuario_lojas for select using (id_usuario = auth.uid());

-- Atualiza as policies de gestão para aceitar QUALQUER loja vinculada
-- ao usuário (antes, olhavam só para `usuarios`; agora olham para
-- `usuario_lojas`, que permite múltiplas linhas por usuário)
drop policy if exists "loja gerencia estabelecimento" on estabelecimentos;
create policy "loja gerencia estabelecimento" on estabelecimentos for update
  using (id in (select estabelecimento_id from usuario_lojas where id_usuario = auth.uid()));

drop policy if exists "loja gerencia horarios" on horarios_funcionamento;
create policy "loja gerencia horarios" on horarios_funcionamento for all
  using (estabelecimento_id in (select estabelecimento_id from usuario_lojas where id_usuario = auth.uid()));

drop policy if exists "loja gerencia categorias" on categorias;
create policy "loja gerencia categorias" on categorias for all
  using (estabelecimento_id in (select estabelecimento_id from usuario_lojas where id_usuario = auth.uid()));

drop policy if exists "loja gerencia produtos" on produtos;
create policy "loja gerencia produtos" on produtos for all
  using (estabelecimento_id in (select estabelecimento_id from usuario_lojas where id_usuario = auth.uid()));

drop policy if exists "loja gerencia adicionais" on adicionais;
create policy "loja gerencia adicionais" on adicionais for all
  using (produto_id in (select id from produtos where estabelecimento_id in
    (select estabelecimento_id from usuario_lojas where id_usuario = auth.uid())));

drop policy if exists "loja gerencia taxas" on taxas_entrega;
create policy "loja gerencia taxas" on taxas_entrega for all
  using (estabelecimento_id in (select estabelecimento_id from usuario_lojas where id_usuario = auth.uid()));

drop policy if exists "loja atualiza pedidos" on pedidos;
create policy "loja atualiza pedidos" on pedidos for update
  using (estabelecimento_id in (select estabelecimento_id from usuario_lojas where id_usuario = auth.uid()));

drop policy if exists "loja gerencia configuracoes" on configuracoes;
create policy "loja gerencia configuracoes" on configuracoes for all
  using (estabelecimento_id in (select estabelecimento_id from usuario_lojas where id_usuario = auth.uid()));

drop policy if exists "loja le notificacoes" on notificacoes;
create policy "loja le notificacoes" on notificacoes for all
  using (estabelecimento_id in (select estabelecimento_id from usuario_lojas where id_usuario = auth.uid()));

drop policy if exists "loja le push subscriptions" on push_subscriptions;
create policy "loja le push subscriptions" on push_subscriptions for select
  using (estabelecimento_id in (select estabelecimento_id from usuario_lojas where id_usuario = auth.uid()));

-- ============================================================
-- Exemplo: dar a um usuário acesso a uma SEGUNDA loja
-- ============================================================
-- insert into usuario_lojas (id_usuario, estabelecimento_id, papel)
-- values ('UID-DO-USUARIO', 'ID-DA-SEGUNDA-LOJA', 'admin');
