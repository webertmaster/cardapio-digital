-- ============================================================
-- MIGRAÇÃO V12 — autorização com o iFood + pedidos chegando automaticamente
-- Rode este arquivo no SQL Editor do Supabase depois da migracao_v11.sql
-- ============================================================

-- 0. Correção: a migracao_v11 criou a policy de ifood_credenciais usando
-- o padrão antigo (`usuarios`), mas a migracao_v2 já tinha trocado esse
-- padrão por `usuario_lojas` em todas as outras tabelas (pra suportar
-- um usuário administrando mais de uma loja). Alinha aqui.
drop policy if exists "loja gerencia credenciais ifood" on ifood_credenciais;
create policy "loja gerencia credenciais ifood" on ifood_credenciais for all
  using (estabelecimento_id in (select estabelecimento_id from usuario_lojas where id_usuario = auth.uid()));

-- 1. Campos de autorização/token e bookkeeping em ifood_credenciais.
-- user_code/authorization_code_verifier/verification_url são temporários,
-- usados só durante a janela entre "iniciar" autorização e "confirmar".
alter table ifood_credenciais add column if not exists merchant_id text;
alter table ifood_credenciais add column if not exists access_token text;
alter table ifood_credenciais add column if not exists refresh_token text;
alter table ifood_credenciais add column if not exists token_expira_em timestamptz;
alter table ifood_credenciais add column if not exists autorizado boolean not null default false;
alter table ifood_credenciais add column if not exists user_code text;
alter table ifood_credenciais add column if not exists authorization_code_verifier text;
alter table ifood_credenciais add column if not exists verification_url text;
alter table ifood_credenciais add column if not exists produto_placeholder_id uuid references produtos(id);
alter table ifood_credenciais add column if not exists ultimo_polling_em timestamptz;

-- 2. Origem do pedido — permite centralizar iFood + cardápio próprio no
-- mesmo Kanban, mas ainda saber de onde veio cada um.
alter table pedidos add column if not exists origem text not null default 'proprio';
alter table pedidos drop constraint if exists pedidos_origem_check;
alter table pedidos add constraint pedidos_origem_check check (origem in ('proprio', 'ifood'));

alter table pedidos add column if not exists ifood_order_id text unique;

-- Guarda o payload cru do pedido do iFood — serve de rede de segurança
-- caso algum campo mapeado esteja errado (nomes de campo da API do
-- iFood foram levantados por pesquisa, não por leitura direta da doc
-- atual deles), sem precisar buscar o pedido de novo depois.
alter table pedidos add column if not exists ifood_payload_bruto jsonb;

-- Pedido do iFood já vem pago pelo app deles — não se encaixa em
-- pix/dinheiro/cartão/pdv.
alter table pedidos drop constraint if exists pedidos_forma_pagamento_check;
alter table pedidos add constraint pedidos_forma_pagamento_check
  check (forma_pagamento in ('pix', 'dinheiro', 'cartao', 'pdv', 'ifood'));

-- 3. Cron pra chamar a Edge Function de sincronização periodicamente.
-- Substitua SERVICE_ROLE_KEY_AQUI pela service role key do projeto
-- (Project Settings > API Keys) antes de rodar esta parte — não use a
-- anon key aqui, essa chamada precisa de privilégio de service role.
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'ifood-sync-pedidos',
  '* * * * *',
  $$
  select net.http_post(
    url := 'https://psgffdanlpaxgvenzqeh.supabase.co/functions/v1/ifood-sync-pedidos',
    headers := jsonb_build_object('Authorization', 'Bearer SERVICE_ROLE_KEY_AQUI', 'Content-Type', 'application/json')
  );
  $$
);
