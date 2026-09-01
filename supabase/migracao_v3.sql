-- ============================================================
-- MIGRAÇÃO V3 — cancelamento de pedido pelo cliente + contato da loja
-- Rode este arquivo no SQL Editor do Supabase depois da migracao_v2.sql
-- ============================================================

-- 1. Contato da loja (WhatsApp/telefone), pro cliente poder falar com
--    a loja direto da tela de acompanhamento do pedido. Guarde só
--    dígitos, com DDI+DDD (ex: 5511987654321), pra funcionar tanto em
--    link de WhatsApp quanto de ligação.
alter table estabelecimentos add column if not exists whatsapp text;

-- 2. Cancelamento pelo cliente — só enquanto o pedido ainda não entrou
--    em preparo (recebido/aceito). Como o cliente não tem login (só
--    guarda o id do pedido no navegador, igual já acontece hoje pra
--    ele consultar o status), essa função roda com privilégio elevado
--    (security definer) e valida a regra de negócio internamente —
--    não abrimos permissão de UPDATE direto na tabela pra não deixar
--    o cliente alterar outros campos do pedido.
create or replace function cancelar_pedido(p_pedido_id uuid, p_motivo text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  status_atual text;
begin
  select status into status_atual from pedidos where id = p_pedido_id;
  if status_atual is null then
    raise exception 'Pedido não encontrado';
  end if;
  if status_atual not in ('recebido', 'aceito') then
    raise exception 'Este pedido não pode mais ser cancelado';
  end if;

  update pedidos set status = 'cancelado', motivo_recusa = p_motivo, atualizado_em = now()
  where id = p_pedido_id;
end;
$$;

grant execute on function cancelar_pedido(uuid, text) to anon;

-- 3. Notificar a LOJA quando o cliente cancela (a função já existe da
--    migracao_v2.sql — isso só adiciona o caso 'cancelado' a ela,
--    mandando a notificação pra loja em vez de pro cliente).
create or replace function registrar_notificacao_status()
returns trigger as $$
declare
  titulo text;
  corpo text;
  destino_notif text := 'cliente';
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
    when 'cancelado' then
      titulo := 'Pedido cancelado';
      corpo := 'O cliente cancelou o pedido #' || new.numero || '.';
      destino_notif := 'loja';
    else
      return new;
  end case;

  insert into notificacoes (estabelecimento_id, pedido_id, destino, titulo, corpo)
  values (new.estabelecimento_id, new.id, destino_notif, titulo, corpo);

  return new;
end;
$$ language plpgsql;
