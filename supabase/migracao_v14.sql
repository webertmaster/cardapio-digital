-- ============================================================
-- MIGRAÇÃO V14 — corrige RLS de entregadores pra multi-loja
-- Rode este arquivo no SQL Editor do Supabase depois da migracao_v13.sql
-- ============================================================

-- Mesmo bug corrigido na v12 pra ifood_credenciais: essa policy ainda
-- usava o padrão antigo (usuarios), de antes da v2 introduzir a tabela
-- usuario_lojas pra suportar um usuário administrando mais de uma loja.
drop policy if exists "loja gerencia entregadores" on entregadores;
create policy "loja gerencia entregadores" on entregadores for all
  using (estabelecimento_id in (select estabelecimento_id from usuario_lojas where id_usuario = auth.uid()));
