-- Rodar depois da migracao_v18.sql
--
-- Troca a tabela whatsapp_config do fluxo de QR Code (Evolution API) pro
-- fluxo de credenciais da API oficial do WhatsApp (Meta Cloud API).
-- A tabela nunca chegou a ser usada em produção (o pareamento por QR Code
-- da tentativa anterior travou por um bug do próprio WhatsApp), então é
-- seguro alterar as colunas em vez de criar uma tabela nova.

alter table whatsapp_config
  drop column instance_name,
  drop column conectado,
  add column phone_number_id text,
  add column access_token text,
  add column template_name text not null default 'status_pedido';
