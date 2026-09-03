-- ============================================================
-- MIGRAÇÃO V15 — entregador confirma retirada do pedido na loja
-- Rode este arquivo no SQL Editor do Supabase depois da migracao_v14.sql
-- ============================================================

-- Deixa o próprio entregador avançar pronto -> saiu_entrega (hoje só o
-- painel da loja faz essa transição manualmente). A condição
-- "status = 'pronto'" no update impede voltar um pedido que já mudou
-- de estado por outro caminho.
create or replace function entregador_marcar_saiu_entrega(p_pedido_id uuid, p_entregador_id uuid, p_pin text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from entregadores where id = p_entregador_id and pin = p_pin and ativo = true) then
    raise exception 'Acesso inválido';
  end if;
  update pedidos set status = 'saiu_entrega', atualizado_em = now()
  where id = p_pedido_id and entregador_id = p_entregador_id and status = 'pronto';
end;
$$;
grant execute on function entregador_marcar_saiu_entrega(uuid, uuid, text) to anon;
